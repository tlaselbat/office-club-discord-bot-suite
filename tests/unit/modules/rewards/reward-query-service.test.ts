import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { RewardQueryService } from '../../../../src/modules/rewards/services/reward-query-service.js';

describe('RewardQueryService', () => {
  it('returns rank and next threshold for a member profile', async () => {
    const prisma = {
      rewardSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
      rewardMember: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveXp: 75,
          currentLevel: 1,
          tagQualifiedSince: null,
          tagLastCheckedAt: null,
          tagRoleGranted: false,
          user: { displayName: 'Member' },
        }),
        count: vi.fn().mockResolvedValue(3),
      },
      rewardLevel: { findFirst: vi.fn().mockResolvedValue({ level: 2, xpThreshold: 100 }) },
    } as unknown as PrismaClient;

    await expect(new RewardQueryService(prisma).profile('guild-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({ effectiveXp: 75, level: 1, rank: 4 }),
    );
  });

  it('rejects queries while the module is disabled', async () => {
    const prisma = {
      rewardSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: false }) },
    } as unknown as PrismaClient;

    await expect(new RewardQueryService(prisma).leaderboard('guild-1')).rejects.toThrow(
      'Member Rewards is disabled',
    );
  });
});
