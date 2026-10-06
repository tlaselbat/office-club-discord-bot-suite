import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelType, Collection, type Client, type ThreadChannel } from 'discord.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { GameServerUpdateThreadService } from '../../src/modules/game-servers/update-thread-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);

suite('managed game-server update persistence', () => {
  const guildId = `game-updates-test-${randomUUID()}`;

  beforeAll(async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    await prisma.guildSettings.create({ data: { guildId } });
  });

  afterAll(async () => {
    // Jobs have no server foreign key; clean only this suite's unique server IDs.
    const servers = await prisma?.gameServer.findMany({ where: { guildId }, select: { id: true } });
    for (const server of servers ?? []) {
      await prisma?.job.deleteMany({
        where: { payload: { path: ['gameServerId'], equals: server.id } },
      });
      const cards = await prisma?.gameServerCard.findMany({
        where: { gameServerId: server.id },
        select: { id: true },
      });
      for (const card of cards ?? [])
        await prisma?.job.deleteMany({ where: { payload: { path: ['cardId'], equals: card.id } } });
    }
    await prisma?.guildSettings.delete({ where: { guildId } });
    await prisma?.$disconnect();
  });

  it('serializes simultaneous resource creation across independent service clients', async () => {
    if (prisma === null || databaseUrl === undefined) throw new Error('TEST_DATABASE_URL required');
    const server = await prisma.gameServer.create({
      data: { guildId, providerServerId: randomUUID(), displayName: 'Concurrency test' },
    });
    const parentId = randomUUID();
    await prisma.gameServerCard.create({
      data: { gameServerId: server.id, guildId, channelId: parentId, messageId: randomUUID() },
    });
    const channels = new Collection<string, ThreadChannel>();
    let created = 0;
    const parent = {
      id: parentId,
      guildId,
      type: ChannelType.GuildText,
      permissionsFor: () => ({ has: () => true }),
      threads: {
        fetchActive: async () => ({ threads: channels }),
        fetchArchived: async () => ({ threads: new Collection(), hasMore: false }),
        create: async ({ name }: { name: string }) => {
          created += 1;
          const id = randomUUID();
          const thread = {
            id,
            name,
            parentId,
            guildId,
            ownerId: 'test-bot',
            isThread: () => true,
            send: async () => ({}),
          } as unknown as ThreadChannel;
          channels.set(id, thread);
          return thread;
        },
      },
    };
    const discord = {
      user: { id: 'test-bot' },
      channels: { fetch: async (id: string) => (id === parentId ? parent : channels.get(id)) },
    } as unknown as Client;
    const second = createPrismaClient(databaseUrl);
    try {
      await Promise.all([
        new GameServerUpdateThreadService(prisma, discord).ensureThread(server.id, 'ANNOUNCEMENTS'),
        new GameServerUpdateThreadService(second, discord).ensureThread(server.id, 'ANNOUNCEMENTS'),
      ]);
      expect(created).toBe(1);
      expect(
        await prisma.gameServerUpdateThread.count({ where: { gameServerId: server.id } }),
      ).toBe(1);
    } finally {
      await second.$disconnect();
    }
  });

  it('enforces one thread per server/type and globally unique Discord thread IDs', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const server = await prisma.gameServer.create({
      data: { guildId, providerServerId: randomUUID(), displayName: 'Constraint test' },
    });
    const threadId = randomUUID();
    const parentChannelId = randomUUID();
    await prisma.gameServerUpdateThread.create({
      data: { guildId, gameServerId: server.id, type: 'ANNOUNCEMENTS', threadId, parentChannelId },
    });
    await expect(
      prisma.gameServerUpdateThread.create({
        data: {
          guildId,
          gameServerId: server.id,
          type: 'ANNOUNCEMENTS',
          threadId: randomUUID(),
          parentChannelId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.gameServerUpdateThread.create({
        data: { guildId, gameServerId: server.id, type: 'CHANGELOG', threadId, parentChannelId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('persists independent deadlines across clients and cascades only the removed server', async () => {
    if (prisma === null || databaseUrl === undefined) throw new Error('TEST_DATABASE_URL required');
    const server = await prisma.gameServer.create({
      data: { guildId, providerServerId: randomUUID(), displayName: 'Cascade test' },
    });
    const dates = [new Date('2026-10-01T10:00:00Z'), new Date('2026-10-02T11:00:00Z')];
    for (const [index, type] of (['ANNOUNCEMENTS', 'CHANGELOG'] as const).entries()) {
      const started = dates[index];
      if (started === undefined) throw new Error('Missing test timestamp');
      await prisma.gameServerUpdateThread.create({
        data: {
          guildId,
          gameServerId: server.id,
          type,
          threadId: randomUUID(),
          parentChannelId: randomUUID(),
          latestMessageId: randomUUID(),
          latestMessageText: `${type} preview`,
          latestMessageAt: started,
          notificationStartedAt: started,
          notificationExpiresAt: new Date(started.getTime() + 48 * 60 * 60 * 1000),
        },
      });
    }
    const reader = createPrismaClient(databaseUrl);
    try {
      const rows = await reader.gameServerUpdateThread.findMany({
        where: { gameServerId: server.id },
        orderBy: { type: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.latestMessageAt)).toEqual(dates);
      expect(rows.map((row) => row.notificationExpiresAt)).toEqual(
        dates.map((date) => new Date(date.getTime() + 48 * 60 * 60 * 1000)),
      );
      await prisma.gameServer.delete({ where: { id: server.id } });
      expect(
        await reader.gameServerUpdateThread.count({ where: { gameServerId: server.id } }),
      ).toBe(0);
      expect(await reader.guildSettings.findUnique({ where: { guildId } })).not.toBeNull();
    } finally {
      await reader.$disconnect();
    }
  });
});
