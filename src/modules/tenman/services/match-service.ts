import type { PrismaClient } from '../../../generated/prisma/client.js';
import { assertAuthorized, type ActorContext } from '../domain/authorization.js';

/** Queue formation is owned by QueueService; this service owns active-match operations only. */
export class MatchService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async cancel(matchId: string, actor: ActorContext, correlationId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || ['FINISHED', 'CANCELED', 'FAILED'].includes(match.state))
        throw new Error('Match is already terminal');
      assertAuthorized('STOP', actor, match);
      await transaction.match.update({
        where: { id: matchId },
        data: {
          state: 'CANCELED',
          cleanupStatus: 'PENDING',
          guildSlotActive: true,
          finishedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await transaction.matchStateTransition.create({
        data: { matchId, fromState: match.state, toState: 'CANCELED', source: 'DISCORD_CANCEL' },
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
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          correlationId,
          eventType: 'match_canceled',
          result: 'success',
          metadata: {},
        },
      });
    });
  }

  public findGuildMatch(guildId: string) {
    return this.prisma.match.findFirst({
      where: { guildId, guildSlotActive: true },
      include: { players: { orderBy: { joinedAt: 'asc' } }, profile: true },
    });
  }
}
