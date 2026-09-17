import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { RewardDiagnosticsService } from '../../../../src/modules/rewards/services/reward-diagnostics-service.js';

describe('RewardDiagnosticsService', () => {
  it('reports missing configuration', async () => {
    const prisma = {
      rewardSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    await expect(
      new RewardDiagnosticsService(prisma, {} as Client).run('guild-1'),
    ).resolves.toEqual([{ label: 'Rewards configuration', ok: false, detail: 'Not configured' }]);
  });

  it('reports missing channels, blocked roles, stale sessions, and failed jobs', async () => {
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          textChannelIds: ['text-1'],
          voiceChannelIds: [],
          tagRewardRoleId: 'role-1',
          tagReconcileSeconds: 900,
          voiceIntervalSeconds: 300,
        }),
      },
      rewardLevel: { findMany: vi.fn().mockResolvedValue([]) },
      rewardVoiceSession: { count: vi.fn().mockResolvedValue(1) },
      rewardMember: {
        aggregate: vi.fn().mockResolvedValue({ _max: { tagLastCheckedAt: null } }),
      },
      job: { count: vi.fn().mockResolvedValue(1) },
    } as unknown as PrismaClient;
    const discord = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          channels: { fetch: vi.fn().mockResolvedValue(null) },
          roles: {
            fetch: vi.fn().mockResolvedValue({ id: 'role-1', managed: false, position: 10 }),
          },
          members: { fetchMe: vi.fn().mockResolvedValue({ roles: { highest: { position: 5 } } }) },
        }),
      },
    } as unknown as Client;

    const checks = await new RewardDiagnosticsService(prisma, discord).run('guild-1');

    expect(checks.filter((check) => !check.ok).map((check) => check.label)).toEqual(
      expect.arrayContaining([
        'Text channel text-1',
        'Reward role role-1',
        'Voice session freshness',
        'Rewards worker jobs',
      ]),
    );
  });
});
