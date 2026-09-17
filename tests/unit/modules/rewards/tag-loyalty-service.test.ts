import { describe, expect, it, vi } from 'vitest';
import type { Client, GuildMember } from 'discord.js';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { TagLoyaltyService } from '../../../../src/modules/rewards/services/tag-loyalty-service.js';

function member(roleAdd = vi.fn(), roleRemove = vi.fn()) {
  return {
    id: 'user-1',
    displayName: 'Member',
    user: { bot: false },
    roles: { add: roleAdd, remove: roleRemove },
  } as unknown as GuildMember;
}

function discord(rolePosition = 2): Client {
  return {
    guilds: {
      fetch: vi.fn().mockResolvedValue({
        roles: {
          fetch: vi
            .fn()
            .mockResolvedValue({ id: 'tag-role', managed: false, position: rolePosition }),
        },
        members: { fetchMe: vi.fn().mockResolvedValue({ roles: { highest: { position: 10 } } }) },
      }),
    },
  } as unknown as Client;
}

const logger = { warn: vi.fn() } as unknown as Logger;

describe('TagLoyaltyService', () => {
  it('starts a streak on the first successful qualifying observation', async () => {
    const update = vi.fn();
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          tagRequiredSeconds: 3600,
          tagRewardRoleId: 'tag-role',
        }),
      },
      user: { upsert: vi.fn() },
      rewardMember: {
        upsert: vi.fn().mockResolvedValue({ tagQualifiedSince: null, tagRoleGranted: false }),
        update,
      },
    } as unknown as PrismaClient;
    const observedAt = new Date('2026-09-17T12:00:00Z');

    await new TagLoyaltyService(prisma, discord(), logger).observe(
      'guild-1',
      member(),
      true,
      observedAt,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tagQualifiedSince: observedAt, tagRoleGranted: false }),
      }),
    );
  });

  it('grants the role after continuous qualification reaches the threshold', async () => {
    const add = vi.fn();
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          tagRequiredSeconds: 3600,
          tagRewardRoleId: 'tag-role',
        }),
      },
      user: { upsert: vi.fn() },
      rewardMember: {
        upsert: vi.fn().mockResolvedValue({
          tagQualifiedSince: new Date('2026-09-17T10:00:00Z'),
          tagRoleGranted: false,
        }),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;

    await new TagLoyaltyService(prisma, discord(), logger).observe(
      'guild-1',
      member(add),
      true,
      new Date('2026-09-17T12:00:00Z'),
    );

    expect(add).toHaveBeenCalledWith('tag-role', expect.any(String));
  });

  it('removes the role and resets progress on a successful nonqualifying observation', async () => {
    const remove = vi.fn();
    const update = vi.fn();
    const prisma = {
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: true,
          tagRequiredSeconds: 3600,
          tagRewardRoleId: 'tag-role',
        }),
      },
      user: { upsert: vi.fn() },
      rewardMember: {
        upsert: vi.fn().mockResolvedValue({
          tagQualifiedSince: new Date('2026-09-17T10:00:00Z'),
          tagRoleGranted: true,
        }),
        update,
      },
    } as unknown as PrismaClient;

    await new TagLoyaltyService(prisma, discord(), logger).observe(
      'guild-1',
      member(vi.fn(), remove),
      false,
    );

    expect(remove).toHaveBeenCalledWith('tag-role', expect.any(String));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tagQualifiedSince: null, tagRoleGranted: false }),
      }),
    );
  });
});
