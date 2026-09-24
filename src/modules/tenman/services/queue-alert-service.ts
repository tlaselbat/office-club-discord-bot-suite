import type { Client } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

export class QueueAlertService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  public async setPreference(
    guildId: string,
    discordUserId: string,
    queueAlert: boolean,
  ): Promise<void> {
    await this.prisma.tenManNotificationPreference.upsert({
      where: { guildId_discordUserId: { guildId, discordUserId } },
      update: { queueAlert },
      create: { guildId, discordUserId, queueAlert },
    });
  }

  public async maybeSendQueueAlert(
    guildId: string,
    currentCount: number,
    queueSize: number,
  ): Promise<void> {
    const thresholds = queueAlertThresholds(queueSize);
    if (!thresholds.has(currentCount)) return;

    const recipients = await this.prisma.$transaction(async (transaction) => {
      const queue = await transaction.tenManQueue.findUnique({
        where: { guildId },
        select: { lastQueueAlertCount: true },
      });
      const lastCount = queue?.lastQueueAlertCount ?? 0;
      if (currentCount <= lastCount) return [];
      await transaction.tenManQueue.update({
        where: { guildId },
        data: { lastQueueAlertCount: currentCount },
      });
      return transaction.tenManNotificationPreference.findMany({
        where: { guildId, queueAlert: true },
        select: { discordUserId: true },
      });
    });

    const message = `Match Queue is now at **${String(currentCount)}/${String(queueSize)}** players.`;
    await Promise.all(
      recipients.map(async ({ discordUserId }) => {
        try {
          const user = await this.discord.users.fetch(discordUserId);
          await user.send(message);
        } catch {
          // Delivery failure must not affect queue promotion.
        }
      }),
    );
  }

  public async adjustCountAfterLeave(guildId: string, currentCount: number): Promise<void> {
    await this.prisma.tenManQueue.update({
      where: { guildId },
      data: { lastQueueAlertCount: { set: Math.min(currentCount, 0) } },
    });
  }
}

function queueAlertThresholds(queueSize: number): Set<number> {
  return new Set([Math.max(1, queueSize - 2), queueSize - 1]);
}
