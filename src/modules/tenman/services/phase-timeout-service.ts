import type { PrismaClient } from '../../../generated/prisma/client.js';

const TIMEOUT_STATES = ['TEAM_SELECTION', 'MAP_VETO'] as const;
type TimeoutState = (typeof TIMEOUT_STATES)[number];

/**
 * Applies the safe terminal outcome for a phase that cannot safely be
 * completed by a worker. The job payload is deliberately only a compare-and-
 * set hint: state, version and the persisted deadline are rechecked while the
 * match advisory lock is held.
 */
export class PhaseTimeoutService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async expire(
    matchId: string,
    expectedState: string,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    if (!isTimeoutState(expectedState)) return;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { players: true },
      });
      if (
        match === null ||
        match.state !== expectedState ||
        match.version !== expectedVersion ||
        match.phaseDeadlineAt === null ||
        match.phaseDeadlineAt > new Date()
      )
        return;

      const canceled = await transaction.match.updateMany({
        where: { id: matchId, state: expectedState, version: expectedVersion },
        data: {
          state: 'CANCELED',
          cleanupStatus: 'PENDING',
          guildSlotActive: true,
          phaseDeadlineAt: null,
          phaseGeneration: { increment: 1 },
          version: { increment: 1 },
          finishedAt: new Date(),
        },
      });
      if (canceled.count !== 1) return;

      // The match never reached a safe, provisionable configuration. Return
      // every participant to the locked queue; cleanup reopens it atomically.
      if (match.players.length > 0) {
        await transaction.tenManQueueEntry.createMany({
          data: match.players.map((player) => ({
            guildId: match.guildId,
            discordUserId: player.discordUserId,
            steamId64: player.steamId64,
            displayNameSnapshot: player.displayNameSnapshot,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.tenManQueue.upsert({
        where: { guildId: match.guildId },
        update: { status: 'LOCKED', version: { increment: 1 } },
        create: { guildId: match.guildId, status: 'LOCKED' },
      });
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: expectedState,
          toState: 'CANCELED',
          source: `${expectedState}_TIMEOUT`,
        },
      });
      await transaction.job.upsert({
        where: { idempotencyKey: `cleanup:${matchId}` },
        update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
        create: {
          matchId,
          type: 'CLEANUP_MATCH',
          idempotencyKey: `cleanup:${matchId}`,
          payload: { matchId },
        },
      });
      await transaction.job.upsert({
        where: { idempotencyKey: `match-dashboard:${matchId}` },
        update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
        create: {
          matchId,
          type: 'MATCH_DASHBOARD_REFRESH',
          idempotencyKey: `match-dashboard:${matchId}`,
          payload: { matchId },
        },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          eventType: 'match_phase_timeout',
          result: 'success',
          correlationId,
          metadata: { state: expectedState, returnedPlayers: match.players.length },
        },
      });
    });
  }
}

function isTimeoutState(value: string): value is TimeoutState {
  return TIMEOUT_STATES.some((state) => state === value);
}
