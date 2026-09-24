import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';

export class MatchHistoryService {
  public constructor(private readonly prisma: PrismaClient) {}

  /** Reverses only unreversed ledger entries; the match and audit trail remain. */
  public async rollbackResult(
    matchId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) =>
      this.rollbackResultInTransaction(transaction, matchId, actorDiscordUserId, correlationId),
    );
  }

  /** Performs the rollback inside an already-open transaction. */
  public async rollbackResultInTransaction(
    transaction: Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
      ? T
      : never,
    matchId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
    const match = await transaction.match.findUnique({ where: { id: matchId } });
    if (match === null || match.resultStatus !== 'APPLIED') {
      throw new PublicError('RESULT_NOT_APPLIED', 'This match result cannot be rolled back.');
    }
    const changes = await transaction.matchRatingChange.findMany({
      where: { matchId, reversedAt: null },
    });
    if (changes.length === 0)
      throw new PublicError('RESULT_ALREADY_REVERSED', 'This result was already reversed.');
    for (const change of changes) {
      const won = change.delta > 0;
      await transaction.playerGuildStats.update({
        where: {
          guildId_discordUserId: { guildId: match.guildId, discordUserId: change.discordUserId },
        },
        data: {
          rating: { decrement: change.delta },
          wins: { decrement: won ? 1 : 0 },
          losses: { decrement: won ? 0 : 1 },
          matchesPlayed: { decrement: 1 },
        },
      });
    }
    await transaction.matchRatingChange.updateMany({
      where: { matchId, reversedAt: null },
      data: { reversedAt: new Date() },
    });
    await transaction.match.update({
      where: { id: matchId },
      data: { resultStatus: 'REVERSED', version: { increment: 1 } },
    });
    await transaction.auditEvent.create({
      data: {
        matchId,
        guildId: match.guildId,
        actorDiscordUserId,
        eventType: 'match_result_rolled_back',
        result: 'success',
        correlationId,
        metadata: { ratingChanges: changes.length },
      },
    });
  }

  public recentMatches(guildId: string, discordUserId: string, take = 10) {
    return this.prisma.match.findMany({
      where: { guildId, players: { some: { discordUserId } }, state: 'FINISHED' },
      orderBy: { finishedAt: 'desc' },
      take: Math.min(Math.max(1, take), 25),
      select: {
        id: true,
        selectedMap: true,
        score: true,
        result: true,
        resultStatus: true,
        finishedAt: true,
        players: { where: { discordUserId }, select: { team: true } },
      },
    });
  }
}
