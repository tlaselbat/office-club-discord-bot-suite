import type { PrismaClient } from '../../../generated/prisma/client.js';

export class QueueBanService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async ban(
    guildId: string,
    discordUserId: string,
    actorDiscordUserId: string,
    reason: string,
    expiresAt: Date | null,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      await transaction.tenManQueueBan.create({
        data: {
          guildId,
          discordUserId,
          actorDiscordUserId,
          reason,
          ...(expiresAt === null ? {} : { expiresAt }),
        },
      });
      await transaction.tenManQueueEntry.deleteMany({ where: { guildId, discordUserId } });
      await transaction.tenManQueue.updateMany({
        where: { guildId },
        data: { version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'queue_banned',
          result: 'success',
          correlationId,
          metadata: { discordUserId, expiresAt: expiresAt?.toISOString() ?? null },
        },
      });
    });
  }

  public async unban(
    guildId: string,
    discordUserId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      await transaction.tenManQueueBan.updateMany({
        where: { guildId, discordUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'queue_unbanned',
          result: 'success',
          correlationId,
          metadata: { discordUserId },
        },
      });
    });
  }
}
