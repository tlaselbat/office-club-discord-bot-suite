import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { schedulePhaseTimeout } from './phase-timeout-job.js';
import { scheduleJob } from '../../../database/schedule-job.js';

type FormingState = 'READY_CHECK' | 'TEAM_SELECTION' | 'MAP_VETO';

export interface ReplaceParticipantCommand {
  matchId: string;
  outgoingDiscordUserId: string;
  incomingDiscordUserId: string;
  expectedVersion: number;
  actorDiscordUserId: string;
  correlationId: string;
}

/**
 * Privileged mutations. Authorization and signed confirmation belong
 * to the interaction boundary; this service owns the transactional state
 * checks, stale-version rejection, invalidation, and audit record.
 */
export class MatchAdminService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async forceReady(
    matchId: string,
    expectedVersion: number,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockMatch(transaction, matchId);
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { guild: { select: { readyTimeoutSeconds: true } }, players: true },
      });
      assertCurrentState(match, 'READY_CHECK', expectedVersion);
      const deadline = deadlineFrom(match.guild.readyTimeoutSeconds);
      const updated = await transaction.match.updateMany({
        where: {
          id: matchId,
          state: 'READY_CHECK',
          version: expectedVersion,
        },
        data: {
          state: 'TEAM_SELECTION',
          phaseDeadlineAt: deadline,
          phaseGeneration: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw stale();
      await transaction.matchPlayer.updateMany({
        where: { matchId, readyState: { not: 'READY' } },
        data: { readyState: 'READY' },
      });
      await schedulePhaseTimeout(
        transaction,
        matchId,
        'TEAM_SELECTION',
        expectedVersion + 1,
        deadline,
        correlationId,
      );
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'READY_CHECK',
          toState: 'TEAM_SELECTION',
          source: 'ADMIN_FORCE_READY',
        },
      });
      await dashboardRefresh(transaction, matchId);
      await audit(transaction, {
        matchId,
        guildId: match.guildId,
        actorDiscordUserId,
        correlationId,
        eventType: 'admin_force_ready',
        metadata: { playerCount: match.players.length },
      });
    });
  }

  /**
   * A substitution is safe only before teams/draft/veto history exists. The
   * incoming player must already have an active assigned Steam account; admins do
   * not get to bypass identity integrity by using this control.
   */
  public async replaceParticipant(command: ReplaceParticipantCommand): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockMatch(transaction, command.matchId);
      const match = await transaction.match.findUnique({
        where: { id: command.matchId },
        include: { guild: { select: { readyTimeoutSeconds: true } }, players: true },
      });
      assertCurrentState(match, 'READY_CHECK', command.expectedVersion);
      if (command.outgoingDiscordUserId === command.incomingDiscordUserId)
        throw new PublicError('REPLACEMENT_INVALID', 'Choose a different replacement player.');
      const outgoing = match.players.find(
        (player) => player.discordUserId === command.outgoingDiscordUserId,
      );
      if (outgoing === undefined)
        throw new PublicError('NOT_PARTICIPANT', 'The player being replaced is not in this match.');
      if (match.players.some((player) => player.discordUserId === command.incomingDiscordUserId))
        throw new PublicError(
          'ALREADY_PARTICIPANT',
          'The replacement player is already in this match.',
        );

      const [identity, user, ban] = await Promise.all([
        transaction.steamIdentity.findFirst({
          where: { discordUserId: command.incomingDiscordUserId, invalidatedAt: null },
          orderBy: { assignedAt: 'desc' },
        }),
        transaction.user.findUnique({ where: { discordUserId: command.incomingDiscordUserId } }),
        transaction.tenManQueueBan.findFirst({
          where: {
            guildId: match.guildId,
            discordUserId: command.incomingDiscordUserId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
      ]);
      if (identity === null || user === null)
        throw new PublicError(
          'STEAM_REQUIRED',
          'The replacement player needs an assigned Steam account.',
        );
      if (ban !== null)
        throw new PublicError('QUEUE_BANNED', 'The replacement player is banned from this queue.');
      if (match.players.some((player) => player.steamId64 === identity.steamId64))
        throw new PublicError('DUPLICATE_STEAM', 'That Steam account is already in this match.');

      const deadline = deadlineFrom(match.guild.readyTimeoutSeconds);
      const updated = await transaction.match.updateMany({
        where: {
          id: command.matchId,
          state: 'READY_CHECK',
          version: command.expectedVersion,
        },
        data: {
          phaseDeadlineAt: deadline,
          phaseGeneration: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw stale();
      await transaction.matchPlayer.delete({
        where: {
          matchId_discordUserId: {
            matchId: command.matchId,
            discordUserId: command.outgoingDiscordUserId,
          },
        },
      });
      await transaction.matchPlayer.create({
        data: {
          matchId: command.matchId,
          discordUserId: command.incomingDiscordUserId,
          steamId64: identity.steamId64,
          displayNameSnapshot: user.displayName,
          readyState: 'NOT_READY',
        },
      });
      await scheduleReadyTimeout(
        transaction,
        command.matchId,
        command.expectedVersion + 1,
        deadline,
        command.correlationId,
      );
      await dashboardRefresh(transaction, command.matchId);
      await audit(transaction, {
        matchId: command.matchId,
        guildId: match.guildId,
        actorDiscordUserId: command.actorDiscordUserId,
        correlationId: command.correlationId,
        eventType: 'admin_participant_replaced',
        metadata: {
          outgoingDiscordUserId: command.outgoingDiscordUserId,
          incomingDiscordUserId: command.incomingDiscordUserId,
        },
      });
    });
  }

  /** Restarts the current durable forming phase and invalidates every control. */
  public async restartFormingPhase(
    matchId: string,
    expectedVersion: number,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockMatch(transaction, matchId);
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { guild: { select: { readyTimeoutSeconds: true } } },
      });
      if (match === null || !isFormingState(match.state))
        throw new PublicError(
          'PHASE_UNAVAILABLE',
          'This match is not in a restartable forming phase.',
        );
      if (match.version !== expectedVersion) throw stale();
      const deadline = deadlineFrom(match.guild.readyTimeoutSeconds);
      if (match.state === 'READY_CHECK') {
        await transaction.matchPlayer.updateMany({
          where: { matchId },
          data: { readyState: 'NOT_READY' },
        });
      } else if (match.state === 'TEAM_SELECTION') {
        await transaction.matchDraftPick.deleteMany({ where: { matchId } });
        await transaction.matchPlayer.updateMany({
          where: { matchId },
          data: { captainTeam: null, team: 'UNASSIGNED', draftOrder: null },
        });
      } else {
        await transaction.matchVetoAction.deleteMany({ where: { matchId } });
      }
      const updated = await transaction.match.updateMany({
        where: { id: matchId, state: match.state, version: expectedVersion },
        data: {
          phaseDeadlineAt: deadline,
          ...(match.state === 'MAP_VETO' ? { selectedMap: null } : {}),
          phaseGeneration: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw stale();
      if (match.state === 'READY_CHECK') {
        await scheduleReadyTimeout(
          transaction,
          matchId,
          expectedVersion + 1,
          deadline,
          correlationId,
        );
      } else {
        await schedulePhaseTimeout(
          transaction,
          matchId,
          match.state,
          expectedVersion + 1,
          deadline,
          correlationId,
        );
      }
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: match.state,
          toState: match.state,
          source: 'ADMIN_RESTART_PHASE',
        },
      });
      await dashboardRefresh(transaction, matchId);
      await audit(transaction, {
        matchId,
        guildId: match.guildId,
        actorDiscordUserId,
        correlationId,
        eventType: 'admin_phase_restarted',
        metadata: { state: match.state },
      });
    });
  }

  /** Resets current standings only; match and rating-change history is retained. */
  public async resetPlayerStats(
    guildId: string,
    targetDiscordUserId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const user = await transaction.user.findUnique({
        where: { discordUserId: targetDiscordUserId },
      });
      if (user === null)
        throw new PublicError('PLAYER_NOT_FOUND', 'That player is not known to the bot.');
      await transaction.playerGuildStats.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId: targetDiscordUserId } },
        update: { rating: 1000, wins: 0, losses: 0, matchesPlayed: 0 },
        create: { guildId, discordUserId: targetDiscordUserId, rating: 1000 },
      });
      await audit(transaction, {
        guildId,
        actorDiscordUserId,
        correlationId,
        eventType: 'admin_player_stats_reset',
        metadata: { targetDiscordUserId },
      });
    });
  }
}

type Transaction = Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
  ? T
  : never;

async function lockMatch(transaction: Transaction, matchId: string): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
}

function deadlineFrom(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function isFormingState(state: string): state is FormingState {
  return state === 'READY_CHECK' || state === 'TEAM_SELECTION' || state === 'MAP_VETO';
}

function assertCurrentState(
  match: { state: string; version: number } | null,
  state: FormingState,
  expectedVersion: number,
): asserts match is NonNullable<typeof match> {
  if (match === null || match.state !== state)
    throw new PublicError(
      'PHASE_UNAVAILABLE',
      'This administrative action is no longer available.',
    );
  if (match.version !== expectedVersion) throw stale();
}

function stale(): PublicError {
  return new PublicError('STALE_COMPONENT', 'This administrative control is stale.');
}

async function scheduleReadyTimeout(
  transaction: Transaction,
  matchId: string,
  expectedVersion: number,
  deadline: Date,
  correlationId: string,
): Promise<void> {
  await scheduleJob(transaction, {
    type: 'MATCH_PHASE_TIMEOUT',
    idempotencyKey: `phase-timeout:${matchId}:READY_CHECK:${String(expectedVersion)}`,
    matchId,
    runAt: deadline,
    payload: {
      matchId,
      expectedState: 'READY_CHECK',
      expectedVersion,
      deadline: deadline.toISOString(),
      correlationId,
    },
  });
}

async function dashboardRefresh(transaction: Transaction, matchId: string): Promise<void> {
  await scheduleJob(transaction, {
    type: 'MATCH_DASHBOARD_REFRESH',
    idempotencyKey: `match-dashboard:${matchId}`,
    matchId,
    payload: { matchId },
  });
}

async function audit(
  transaction: Transaction,
  event: {
    matchId?: string;
    guildId: string;
    actorDiscordUserId: string;
    correlationId: string;
    eventType: string;
    metadata: Prisma.InputJsonObject;
  },
): Promise<void> {
  await transaction.auditEvent.create({
    data: {
      guildId: event.guildId,
      actorDiscordUserId: event.actorDiscordUserId,
      correlationId: event.correlationId,
      eventType: event.eventType,
      result: 'success',
      metadata: event.metadata,
      ...(event.matchId === undefined ? {} : { matchId: event.matchId }),
    },
  });
}
