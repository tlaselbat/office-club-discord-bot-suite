import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { MatchResourceService } from '../../../src/modules/tenman/services/match-resource-service.js';

const activeMatch = {
  id: 'match-1',
  guildId: 'guild-1',
  matchzyMatchId: 42,
  state: 'READY_CHECK',
  cleanupStatus: 'NOT_REQUIRED',
};

function resource(state: string, ioStartedAt: Date | null, leaseExpiresAt: Date | null) {
  return {
    id: 'resource-1',
    matchId: 'match-1',
    resourceType: 'MATCH_TEXT_CHANNEL',
    discordId: null,
    createdByBot: false,
    state,
    creationAttemptId: 'attempt-old',
    creationIoStartedAt: ioStartedAt,
    creationLeaseExpiresAt: leaseExpiresAt,
  };
}

function createPrisma(rows: ReturnType<typeof resource>[]): {
  prisma: PrismaClient;
  updateMany: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transaction = {
    match: { findUnique: vi.fn().mockResolvedValue(activeMatch) },
    tenManSettings: { findUnique: vi.fn().mockResolvedValue({ managedCategoryId: 'category-1' }) },
    matchDiscordResource: { upsert: vi.fn().mockImplementation(() => rows.shift()) },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      match: { findUnique: vi.fn().mockResolvedValue(activeMatch) },
      tenManSettings: {
        findUnique: vi.fn().mockResolvedValue({ managedCategoryId: 'category-1' }),
      },
      matchDiscordResource: {
        updateMany,
        update: vi.fn().mockResolvedValue(undefined),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient,
    updateMany,
  };
}

function createClient() {
  const channel = { id: 'channel-1', delete: vi.fn().mockResolvedValue(undefined) };
  const create = vi.fn().mockResolvedValue(channel);
  return {
    client: {
      guilds: { fetch: vi.fn().mockResolvedValue({ channels: { create } }) },
      channels: { fetch: vi.fn().mockResolvedValue(null) },
    },
    create,
  };
}

describe('MatchResourceService durable creation recovery', () => {
  it('reclaims only an expired pre-I/O claim before creating a replacement channel', async () => {
    const { prisma, updateMany } = createPrisma([
      resource('CREATE_IN_FLIGHT', null, new Date(Date.now() - 1)),
      resource('PENDING_CREATE', null, null),
    ]);
    const { client, create } = createClient();

    await expect(
      new MatchResourceService(prisma, client as never).ensureMatchTextChannel('match-1'),
    ).resolves.toBe('channel-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: 'CREATE_IN_FLIGHT',
          creationIoStartedAt: null,
          creationLeaseExpiresAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it('never retries an attempt once Discord creation may have started', async () => {
    const { prisma, updateMany } = createPrisma([
      resource('CREATE_IN_FLIGHT', new Date(Date.now() - 60_000), new Date(Date.now() - 1)),
    ]);
    updateMany.mockResolvedValue({ count: 0 });
    const { client, create } = createClient();

    await expect(
      new MatchResourceService(prisma, client as never).ensureMatchTextChannel('match-1'),
    ).rejects.toThrow('ambiguous');
    expect(create).not.toHaveBeenCalled();
  });

  it('cancels a pre-I/O creation without issuing a destructive Discord call', async () => {
    const { prisma, updateMany } = createPrisma([]);
    (prisma.matchDiscordResource.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      resource('CREATE_IN_FLIGHT', null, new Date(Date.now() + 60_000)),
    );
    const { client } = createClient();

    await new MatchResourceService(prisma, client as never).archiveOwnedChannel('resource-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'DELETED' }) }),
    );
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('archives and locks a proven bot-owned channel without deleting it', async () => {
    const { prisma } = createPrisma([]);
    const owned = {
      ...resource('ACTIVE', new Date(), null),
      discordId: 'channel-1',
      createdByBot: true,
    };
    (prisma.matchDiscordResource.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(owned);
    const edit = vi.fn().mockResolvedValue(undefined);
    const permissionEdit = vi.fn().mockResolvedValue(undefined);
    const deleteChannel = vi.fn().mockResolvedValue(undefined);
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          name: 'match-42',
          guild: { roles: { everyone: { id: 'everyone' } } },
          isTextBased: () => true,
          edit,
          delete: deleteChannel,
          permissionOverwrites: { edit: permissionEdit },
        }),
      },
    };

    await new MatchResourceService(prisma, client as never).archiveOwnedChannel('resource-1');

    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ name: 'archived-competitive-match-42' }));
    expect(permissionEdit).toHaveBeenCalledWith(
      { id: 'everyone' },
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
    );
    expect(deleteChannel).not.toHaveBeenCalled();
    expect(prisma.matchDiscordResource.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'ARCHIVED' }) }),
    );
  });
});
