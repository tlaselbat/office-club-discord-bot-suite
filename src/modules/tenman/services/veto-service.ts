import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { schedulePhaseTimeout } from './phase-timeout-job.js';
import { assertSupportedFormationPolicy } from './formation-policy.js';

export class VetoService {
  public constructor(private readonly prisma: PrismaClient) {}

  /** BO1 alternating-ban veto. The final remaining allowlisted map is persisted. */
  public async ban(
    matchId: string,
    captainDiscordUserId: string,
    mapName: string,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: {
          players: true,
          profile: true,
          vetoActions: true,
          guild: {
            select: { captainPolicy: true, teamSelectionMode: true, mapSelectionMode: true },
          },
        },
      });
      if (match === null || match.state !== 'MAP_VETO')
        throw new PublicError('VETO_UNAVAILABLE', 'Map veto is no longer active.');
      if (match.version !== expectedVersion)
        throw new PublicError('STALE_COMPONENT', 'This control is stale.');
      assertSupportedFormationPolicy(match.guild);
      if (match.guild.mapSelectionMode !== 'CAPTAIN_VETO') {
        throw new PublicError('VETO_UNAVAILABLE', 'This match does not use a captain map veto.');
      }
      if (match.phaseDeadlineAt === null || match.phaseDeadlineAt <= new Date())
        throw new PublicError('STALE_COMPONENT', 'Map veto has expired.');
      if (
        !match.profile.mapAllowlist.includes(mapName) ||
        match.vetoActions.some((action) => action.mapName === mapName)
      )
        throw new PublicError('MAP_UNAVAILABLE', 'That map is unavailable.');
      const expectedTeam = match.vetoActions.length % 2 === 0 ? 'TEAM_1' : 'TEAM_2';
      const captain = match.players.find((player) => player.discordUserId === captainDiscordUserId);
      if (captain?.captainTeam !== expectedTeam)
        throw new PublicError('NOT_VETO_TURN', 'It is not your veto turn.');
      const sequence = match.vetoActions.length + 1;
      await transaction.matchVetoAction.create({
        data: { matchId, sequence, actorTeam: expectedTeam, action: 'BAN', mapName },
      });
      const remaining = match.profile.mapAllowlist.filter(
        (candidate) =>
          candidate !== mapName &&
          !match.vetoActions.some((action) => action.mapName === candidate),
      );
      const complete = remaining.length === 1;
      const finalMap = remaining.at(0);
      if (complete && finalMap === undefined) throw new Error('Veto has no final map');
      const selectedMap: string | null = complete ? (finalMap ?? null) : null;
      const updated = await transaction.match.updateMany({
        where: { id: matchId, version: expectedVersion, state: 'MAP_VETO' },
        data: {
          selectedMap,
          state: complete ? 'TEAMS_LOCKED' : 'MAP_VETO',
          phaseDeadlineAt: complete ? null : match.phaseDeadlineAt,
          version: { increment: 1 },
          ...(complete ? { phaseGeneration: { increment: 1 } } : {}),
        },
      });
      if (updated.count !== 1) throw new PublicError('STALE_COMPONENT', 'This control is stale.');
      if (!complete) {
        await schedulePhaseTimeout(
          transaction,
          matchId,
          'MAP_VETO',
          expectedVersion + 1,
          match.phaseDeadlineAt,
          correlationId,
        );
      }
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
      if (complete) {
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: 'MAP_VETO',
            toState: 'TEAMS_LOCKED',
            source: 'VETO_COMPLETE',
          },
        });
        await transaction.job.create({
          data: {
            matchId,
            type: 'PROVISION_SERVER',
            idempotencyKey: `provision:${matchId}`,
            payload: { matchId },
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: captainDiscordUserId,
          eventType: 'veto_ban',
          result: 'success',
          correlationId,
          metadata: { mapName, sequence, complete },
        },
      });
    });
  }
}
