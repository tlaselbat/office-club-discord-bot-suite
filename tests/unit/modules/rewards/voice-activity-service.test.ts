import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import type { LevelRoleService } from '../../../../src/modules/rewards/services/level-role-service.js';
import type { RewardService } from '../../../../src/modules/rewards/services/reward-service.js';
import { VoiceActivityService } from '../../../../src/modules/rewards/services/voice-activity-service.js';

function service(prisma: object, award = vi.fn(), reconcile = vi.fn()) {
  return {
    service: new VoiceActivityService(
      prisma as PrismaClient,
      { award } as unknown as RewardService,
      { reconcile } as unknown as LevelRoleService,
    ),
    award,
    reconcile,
  };
}

describe('VoiceActivityService', () => {
  it('opens a persisted session in an allowlisted channel', async () => {
    const transaction = {
      $executeRaw: vi.fn(),
      rewardVoiceSession: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
      user: { upsert: vi.fn() },
      rewardMember: { upsert: vi.fn() },
    };
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, voiceChannelIds: ['voice-1'] }),
      },
      rewardVoiceSession: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    };

    await service(prisma).service.observe({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      displayName: 'Member',
      channelId: 'voice-1',
      observedAt: new Date('2026-09-17T12:00:00Z'),
    });

    expect(transaction.rewardVoiceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channelId: 'voice-1' }) }),
    );
  });

  it('awards whole intervals once and advances the checkpoint optimistically', async () => {
    const checkpointAt = new Date('2026-09-17T12:00:00Z');
    const prisma = {
      rewardVoiceSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'session-1',
            guildId: 'guild-1',
            discordUserId: 'user-1',
            channelId: 'voice-1',
            checkpointAt,
            version: 2,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          voiceXpAmount: 5,
          voiceIntervalSeconds: 300,
          voiceChannelIds: ['voice-1'],
        }),
      },
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ displayName: 'Member' }) },
    };
    const award = vi.fn().mockResolvedValue({ applied: true, effectiveXp: 10, level: 0 });
    const reconcile = vi.fn();
    const instance = service(prisma, award, reconcile).service;

    await expect(instance.accrue(new Date('2026-09-17T12:12:00Z'))).resolves.toBe(1);
    expect(award).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10,
        idempotencyKey: 'voice:session-1:2026-09-17T12:10:00.000Z',
      }),
    );
    expect(prisma.rewardVoiceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ version: 2 }) }),
    );
    expect(reconcile).toHaveBeenCalledWith('guild-1', 'user-1');
  });

  it('does not accrue disabled time', async () => {
    const prisma = {
      rewardVoiceSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'session-1',
            guildId: 'guild-1',
            discordUserId: 'user-1',
            checkpointAt: new Date(0),
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      rewardSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: false }) },
    };
    const { service: instance, award } = service(prisma);

    await expect(instance.accrue(new Date(1_000_000))).resolves.toBe(0);
    expect(award).not.toHaveBeenCalled();
  });
});
