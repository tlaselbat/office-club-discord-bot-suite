import { randomInt } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { schedulePhaseTimeout } from './phase-timeout-job.js';
import { assertSupportedFormationPolicy } from './formation-policy.js';

export class CaptainService {
  public constructor(private readonly prisma: PrismaClient) {}

  /** Selects two distinct captains durably; UI may render only after commit. */
  public async selectRandom(
    matchId: string,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: {
          players: true,
          guild: {
            select: { captainPolicy: true, teamSelectionMode: true, mapSelectionMode: true },
          },
        },
      });
      if (match === null || match.state !== 'TEAM_SELECTION') {
        throw new PublicError('CAPTAINS_UNAVAILABLE', 'Captain selection is no longer active.');
      }
      if (match.version !== expectedVersion)
        throw new PublicError('STALE_COMPONENT', 'This control is stale.');
      assertSupportedFormationPolicy(match.guild);
      if (match.guild.teamSelectionMode !== 'CAPTAINS') {
        throw new PublicError(
          'CAPTAINS_NOT_REQUIRED',
          'Captains cannot be selected when this match uses random teams.',
        );
      }
      if (match.phaseDeadlineAt === null || match.phaseDeadlineAt <= new Date())
        throw new PublicError('STALE_COMPONENT', 'Captain selection has expired.');
      if (match.players.length < 2) throw new Error('At least two players are required');
      const first = randomInt(match.players.length);
      let second = randomInt(match.players.length - 1);
      if (second >= first) second += 1;
      const captain1 = match.players[first];
      const captain2 = match.players[second];
      if (captain1 === undefined || captain2 === undefined)
        throw new Error('Captain selection failed');
      await transaction.matchPlayer.updateMany({
        where: { matchId },
        data: { captainTeam: null, team: 'UNASSIGNED', draftOrder: null },
      });
      await transaction.matchPlayer.update({
        where: { matchId_discordUserId: { matchId, discordUserId: captain1.discordUserId } },
        data: { captainTeam: 'TEAM_1', team: 'TEAM_1', draftOrder: 0 },
      });
      await transaction.matchPlayer.update({
        where: { matchId_discordUserId: { matchId, discordUserId: captain2.discordUserId } },
        data: { captainTeam: 'TEAM_2', team: 'TEAM_2', draftOrder: 0 },
      });
      const updated = await transaction.match.updateMany({
        where: { id: matchId, version: expectedVersion, state: 'TEAM_SELECTION' },
        data: { version: { increment: 1 }, phaseGeneration: { increment: 1 } },
      });
      if (updated.count !== 1) throw new PublicError('STALE_COMPONENT', 'This control is stale.');
      await schedulePhaseTimeout(
        transaction,
        matchId,
        'TEAM_SELECTION',
        expectedVersion + 1,
        match.phaseDeadlineAt,
        correlationId,
      );
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
          eventType: 'captains_selected',
          result: 'success',
          correlationId,
          metadata: { team1: captain1.discordUserId, team2: captain2.discordUserId },
        },
      });
    });
  }
}
