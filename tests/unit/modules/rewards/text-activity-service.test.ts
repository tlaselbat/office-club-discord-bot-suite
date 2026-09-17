import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import type { RewardService } from '../../../../src/modules/rewards/services/reward-service.js';
import { TextActivityService } from '../../../../src/modules/rewards/services/text-activity-service.js';

const activity = {
  guildId: 'guild-1',
  channelId: 'channel-1',
  discordUserId: 'user-1',
  displayName: 'Member',
  messageId: 'message-1',
  occurredAt: new Date('2026-09-17T12:01:05.000Z'),
};

describe('TextActivityService', () => {
  it('ignores disabled and non-allowlisted activity', async () => {
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          textChannelIds: ['other'],
          textXpAmount: 10,
          textCooldownSeconds: 60,
        }),
      },
    } as unknown as PrismaClient;
    const rewards = { award: vi.fn() } as unknown as RewardService;

    await expect(new TextActivityService(prisma, rewards).record(activity)).resolves.toBeNull();
    expect(rewards.award).not.toHaveBeenCalled();
  });

  it('uses a stable member cooldown bucket as the idempotency key', async () => {
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          textChannelIds: ['channel-1'],
          textXpAmount: 12,
          textCooldownSeconds: 60,
        }),
      },
    } as unknown as PrismaClient;
    const award = vi.fn().mockResolvedValue({ applied: true, effectiveXp: 12, level: 0 });
    const rewards = { award } as unknown as RewardService;

    await new TextActivityService(prisma, rewards).record(activity);

    expect(award).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12,
        source: 'TEXT_ACTIVITY',
        idempotencyKey: 'text:message-1',
        textCooldownSeconds: 60,
      }),
    );
  });
});
