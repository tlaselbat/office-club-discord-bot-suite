import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { LevelRoleService } from '../../../../src/modules/rewards/services/level-role-service.js';

describe('LevelRoleService', () => {
  it('adds earned roles and removes only configured unearned roles', async () => {
    const add = vi.fn();
    const remove = vi.fn();
    const member = {
      roles: {
        cache: new Map([
          ['high-level', {}],
          ['unrelated', {}],
        ]),
        add,
        remove,
      },
    };
    const botMember = { roles: { highest: { position: 10 } } };
    const roles = new Map([
      ['entry-level', { id: 'entry-level', managed: false, position: 2 }],
      ['high-level', { id: 'high-level', managed: false, position: 3 }],
    ]);
    const discord = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          members: {
            fetch: vi.fn().mockResolvedValue(member),
            fetchMe: vi.fn().mockResolvedValue(botMember),
          },
          roles: { fetch: vi.fn().mockResolvedValue(roles) },
        }),
      },
    } as unknown as Client;
    const prisma = {
      rewardMember: { findUnique: vi.fn().mockResolvedValue({ effectiveXp: 50 }) },
      rewardLevel: {
        findMany: vi.fn().mockResolvedValue([
          { xpThreshold: 10, roleId: 'entry-level' },
          { xpThreshold: 100, roleId: 'high-level' },
        ]),
      },
    } as unknown as PrismaClient;

    await new LevelRoleService(prisma, discord).reconcile('guild-1', 'user-1');

    expect(add).toHaveBeenCalledWith(['entry-level'], expect.any(String));
    expect(remove).toHaveBeenCalledWith(['high-level'], expect.any(String));
  });

  it('rejects roles above the bot role', async () => {
    const discord = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          members: {
            fetch: vi.fn().mockResolvedValue({ roles: { cache: new Map() } }),
            fetchMe: vi.fn().mockResolvedValue({ roles: { highest: { position: 5 } } }),
          },
          roles: {
            fetch: vi
              .fn()
              .mockResolvedValue(
                new Map([['blocked', { id: 'blocked', managed: false, position: 5 }]]),
              ),
          },
        }),
      },
    } as unknown as Client;
    const prisma = {
      rewardMember: { findUnique: vi.fn().mockResolvedValue({ effectiveXp: 100 }) },
      rewardLevel: {
        findMany: vi.fn().mockResolvedValue([{ xpThreshold: 10, roleId: 'blocked' }]),
      },
    } as unknown as PrismaClient;

    await expect(
      new LevelRoleService(prisma, discord).reconcile('guild-1', 'user-1'),
    ).rejects.toThrow('not below the bot role');
  });
});
