import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { AwardXpResult, RewardService } from './reward-service.js';

export interface TextActivity {
  guildId: string;
  channelId: string;
  discordUserId: string;
  displayName: string;
  messageId: string;
  occurredAt: Date;
}

export class TextActivityService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly rewards: RewardService,
  ) {}

  public async record(activity: TextActivity): Promise<AwardXpResult | null> {
    const settings = await this.prisma.rewardSettings.findUnique({
      where: { guildId: activity.guildId },
      select: {
        enabled: true,
        textChannelIds: true,
        textXpAmount: true,
        textCooldownSeconds: true,
      },
    });
    if (settings?.enabled !== true || !settings.textChannelIds.includes(activity.channelId))
      return null;
    return this.rewards.award({
      guildId: activity.guildId,
      discordUserId: activity.discordUserId,
      displayName: activity.displayName,
      amount: settings.textXpAmount,
      source: 'TEXT_ACTIVITY',
      idempotencyKey: `text:${activity.messageId}`,
      metadata: { channelId: activity.channelId },
      awardedAt: activity.occurredAt,
      textCooldownSeconds: settings.textCooldownSeconds,
    });
  }
}
