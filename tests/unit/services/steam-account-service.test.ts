import { describe, expect, it, vi } from 'vitest';
import {
  SteamAccountService,
  isSteamIdentityLocked,
} from '../../../src/modules/tenman/services/steam-account-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const profileService = {
  resolveVanityUrl: vi.fn().mockResolvedValue('76561198000000001'),
  getPlayerSummary: vi.fn().mockResolvedValue({
    steamId64: '76561198000000001',
    displayName: 'PlayerOne',
    profileUrl: undefined,
  }),
};

function createPrisma(
  overrides?: Partial<{
    queued: boolean;
    activeMatch: boolean;
    existing: { id: string; steamId64: string } | null;
    duplicate: { id: string; discordUserId: string; steamId64: string } | null;
  }>,
) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    tenManQueueEntry: {
      findFirst: vi.fn().mockResolvedValue(overrides?.queued ? { id: 'q' } : null),
    },
    matchPlayer: {
      findFirst: vi.fn().mockResolvedValue(overrides?.activeMatch ? { id: 'm' } : null),
    },
    user: {
      upsert: vi.fn().mockResolvedValue({ discordUserId: 'user-1', displayName: 'User' }),
    },
    steamIdentity: {
      findFirst: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) => {
        if ('discordUserId' in args.where && overrides?.existing) return overrides.existing;
        if ('steamId64' in args.where && overrides?.duplicate) return overrides.duplicate;
        return null;
      }),
      create: vi.fn().mockResolvedValue({ id: 'new-id', steamId64: '76561198000000001' }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };

  return {
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient,
    transaction,
  };
}

describe('SteamAccountService', () => {
  it('assigns a new Steam identity', async () => {
    const { prisma, transaction } = createPrisma();
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.assign({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      rawInput: '76561198000000001',
      correlationId: 'corr-1',
    });

    expect(result).toMatchObject({ status: 'assigned', steamId64: '76561198000000001' });
    expect(transaction.steamIdentity.create).toHaveBeenCalled();
    expect(transaction.auditEvent.create).toHaveBeenCalled();
  });

  it('rejects an invalid identifier', async () => {
    const { prisma } = createPrisma();
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.assign({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      rawInput: 'not-a-steam-id',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ status: 'invalid_input' });
  });

  it('flags a duplicate Steam ID assigned to another Discord user', async () => {
    const { prisma } = createPrisma({
      duplicate: { id: 'dup', discordUserId: 'other-user', steamId64: '76561198000000001' },
    });
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.assign({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      rawInput: '76561198000000001',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ status: 'duplicate', steamId64: '76561198000000001' });
  });

  it('prevents assignment while the user is in the queue', async () => {
    const { prisma } = createPrisma({ queued: true });
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.assign({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      rawInput: '76561198000000001',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ status: 'locked', reason: 'QUEUED' });
  });

  it('removes an active identity', async () => {
    const { prisma } = createPrisma({
      existing: { id: 'old', steamId64: '76561198000000001' },
    });
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.remove({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ status: 'removed' });
  });

  it('reports no assignment to remove', async () => {
    const { prisma } = createPrisma();
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.remove({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ status: 'no_assignment' });
  });

  it('blocks removal while queued', async () => {
    const { prisma } = createPrisma({ queued: true });
    const service = new SteamAccountService(prisma, profileService);

    const result = await service.remove({
      discordUserId: 'user-1',
      guildId: 'guild-1',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({ status: 'locked', reason: 'QUEUED' });
  });
});

describe('isSteamIdentityLocked', () => {
  it('returns QUEUED when the user is in the queue', async () => {
    const prisma = {
      tenManQueueEntry: { findFirst: vi.fn().mockResolvedValue({ id: 'q' }) },
      matchPlayer: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const result = await isSteamIdentityLocked(
      prisma as unknown as Parameters<typeof isSteamIdentityLocked>[0],
      'user-1',
    );

    expect(result).toEqual({ locked: true, reason: 'QUEUED' });
  });

  it('returns MATCH when the user is in an active match', async () => {
    const prisma = {
      tenManQueueEntry: { findFirst: vi.fn().mockResolvedValue(null) },
      matchPlayer: { findFirst: vi.fn().mockResolvedValue({ id: 'm' }) },
    };

    const result = await isSteamIdentityLocked(
      prisma as unknown as Parameters<typeof isSteamIdentityLocked>[0],
      'user-1',
    );

    expect(result).toEqual({ locked: true, reason: 'MATCH' });
  });
});
