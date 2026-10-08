import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelType,
  Collection,
  DiscordAPIError,
  MessageType,
  type Client,
  type Message,
} from 'discord.js';
import type {
  GameServerUpdateThread,
  PrismaClient,
} from '../../../../src/generated/prisma/client.js';
import {
  GameServerUpdateThreadService,
  managedThreadName,
  NEW_WINDOW_MS,
  normalizeUpdatePreview,
} from '../../../../src/modules/game-servers/update-thread-service.js';

const serverId = '513af1bb-31fa-4b17-bd2e-2ec450984cea';
const now = new Date('2026-10-04T12:00:00Z');
const guildId = '100000000000000001';
const threadId = '100000000000000002';
const botId = '100000000000000003';
const parentId = '100000000000000004';

function row(overrides: Partial<GameServerUpdateThread> = {}): GameServerUpdateThread {
  return {
    id: 'row-1',
    guildId,
    gameServerId: serverId,
    type: 'ANNOUNCEMENTS',
    threadId,
    parentChannelId: parentId,
    latestMessageId: null,
    latestMessageText: null,
    latestMessageAt: null,
    notificationStartedAt: null,
    notificationExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function message(
  id = '100000000000000100',
  options: {
    official?: boolean;
    bot?: boolean;
    content?: string;
    date?: Date;
    type?: MessageType;
    threadId?: string;
  } = {},
): Message {
  const date = options.date ?? now;
  return {
    id,
    channelId: options.threadId ?? threadId,
    guildId,
    partial: false,
    type: options.type ?? MessageType.Default,
    content: options.content ?? '**Server is back up!**',
    createdAt: date,
    createdTimestamp: date.getTime(),
    editedTimestamp: null,
    author: { id: options.bot ? botId : 'staff', bot: options.bot ?? false },
    webhookId: null,
    attachments: new Collection(),
    member: { id: 'staff' },
    guild: { members: { fetch: vi.fn() } },
    inGuild: () => true,
    channel: {
      isThread: () => true,
      permissionsFor: () => ({ any: () => options.official ?? true }),
    },
  } as unknown as Message;
}

function fixture(initial: GameServerUpdateThread[] = [row()]) {
  const rows = new Map(initial.map((item) => [item.id, { ...item }]));
  const threads = new Map<string, ReturnType<typeof fakeThread>>();
  let sequence = 20;
  function fakeThread(id = threadId, archived = false) {
    return {
      id,
      guildId,
      parentId,
      ownerId: botId,
      archived,
      name: managedThreadName('Arena', serverId, 'ANNOUNCEMENTS'),
      archiveTimestamp: now.getTime(),
      isThread: () => true,
      send: vi.fn().mockResolvedValue({}),
      setArchived: vi.fn().mockResolvedValue({}),
      messages: { fetch: vi.fn().mockResolvedValue(new Collection()) },
    };
  }
  threads.set(threadId, fakeThread());
  const parent = {
    id: parentId,
    guildId,
    type: ChannelType.GuildText,
    permissionsFor: vi.fn().mockReturnValue({ has: () => true }),
    threads: {
      fetchActive: vi.fn(async () => ({
        threads: new Collection([...threads].filter(([, thread]) => !thread.archived)),
      })),
      fetchArchived: vi.fn(async () => ({
        threads: new Collection([...threads].filter(([, thread]) => thread.archived)),
        hasMore: false,
      })),
      create: vi.fn(async (options: { name: string }) => {
        const created = fakeThread(`1000000000000000${String(sequence++)}`);
        created.name = options.name;
        threads.set(created.id, created);
        return created;
      }),
    },
  };
  function lookup(where: Record<string, unknown>) {
    return (
      [...rows.values()].find((item) => {
        if ('gameServerId_type' in where) {
          const key = where.gameServerId_type as { gameServerId: string; type: string };
          return item.gameServerId === key.gameServerId && item.type === key.type;
        }
        return Object.entries(where).every(([key, value]) => {
          const actual = item[key as keyof GameServerUpdateThread];
          return actual instanceof Date && value instanceof Date
            ? actual.getTime() === value.getTime()
            : actual === value;
        });
      }) ?? null
    );
  }
  const db = {
    gameServerSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    gameServer: {
      findUnique: vi.fn().mockResolvedValue({
        id: serverId,
        displayName: 'Arena',
        guildId,
        enabled: true,
        public: true,
        cards: [{ id: 'card-1', channelId: parentId }],
      }),
    },
    gameServerCard: { findMany: vi.fn().mockResolvedValue([{ id: 'card-1' }]) },
    gameServerUpdateThread: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const item = lookup(where);
        return item === null ? null : { ...item };
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const item = lookup(where);
        return item === null ? null : { ...item };
      }),
      findMany: vi.fn(async () => [...rows.values()].map((item) => ({ ...item }))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const item = lookup(where);
        if (item === null) throw new Error('Missing');
        return { ...item };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<GameServerUpdateThread>;
        }) => {
          const item = lookup(where);
          if (item === null) return { count: 0 };
          Object.assign(item, data);
          return { count: 1 };
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: Record<string, unknown>;
          create: Partial<GameServerUpdateThread>;
          update: Partial<GameServerUpdateThread>;
        }) => {
          const item = lookup(where);
          if (item !== null) {
            Object.assign(item, update);
            return item;
          }
          const added = row({ ...create, id: `row-${String(rows.size + 1)}` });
          rows.set(added.id, added);
          return added;
        },
      ),
    },
    job: { upsert: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
  } as unknown as PrismaClient;
  const fetch = vi.fn(async (id: string) => {
    if (id === parentId) return parent;
    const thread = threads.get(id);
    if (thread === undefined) throw apiError(10003, 404);
    return thread;
  });
  const discord = { user: { id: botId }, channels: { fetch } } as unknown as Client;
  return {
    service: new GameServerUpdateThreadService(prisma, discord),
    db,
    rows,
    threads,
    parent,
    fetch,
    fakeThread,
  };
}

function apiError(code: number, status: number) {
  return new DiscordAPIError(
    { code, message: 'Discord failure' },
    code,
    status,
    'GET',
    'https://discord.com/api/v10/channels/test',
    {},
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('managed update lifecycle', () => {
  it('does not create or reconcile Discord threads while the module is disabled', async () => {
    const f = fixture();
    f.db.gameServerSettings.findUnique.mockResolvedValue({ enabled: false } as never);
    await f.service.ensureThread(serverId, 'ANNOUNCEMENTS');
    await expect(f.service.reconcile(serverId)).resolves.toBeUndefined();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.parent.threads.create).not.toHaveBeenCalled();
  });
  it('creates both missing resources and then preserves IDs without duplicate creation', async () => {
    const f = fixture([]);
    f.threads.clear();
    await f.service.ensureThreads(serverId);
    expect(f.parent.threads.create).toHaveBeenCalledTimes(2);
    expect(f.rows.size).toBe(2);
    for (const call of f.parent.threads.create.mock.calls)
      expect(call[0]).toMatchObject({ autoArchiveDuration: 10080 });
    await f.service.ensureThreads(serverId);
    expect(f.parent.threads.create).toHaveBeenCalledTimes(2);
    expect(f.db.$executeRaw).toHaveBeenCalledTimes(4);
  });
  it('keeps an archived thread without sending or unarchiving', async () => {
    const f = fixture();
    const thread = f.threads.get(threadId);
    if (!thread) throw new Error('Fixture');
    thread.archived = true;
    await f.service.ensureThread(serverId, 'ANNOUNCEMENTS');
    expect(f.parent.threads.create).not.toHaveBeenCalled();
    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
  });
  it('recovers a bot-owned archived thread after Discord success / database rollback', async () => {
    const f = fixture([]);
    const thread = f.threads.get(threadId);
    if (!thread) throw new Error('Fixture');
    thread.archived = true;
    await f.service.ensureThread(serverId, 'ANNOUNCEMENTS');
    expect(f.parent.threads.create).not.toHaveBeenCalled();
    expect([...f.rows.values()][0]?.threadId).toBe(threadId);
    expect(thread.send).not.toHaveBeenCalled();
  });
  it('replaces a confirmed deleted thread and clears its old preview', async () => {
    const f = fixture([row({ latestMessageId: '100', latestMessageText: 'Old' })]);
    f.threads.clear();
    await f.service.ensureThread(serverId, 'ANNOUNCEMENTS');
    expect(f.parent.threads.create).toHaveBeenCalledTimes(1);
    expect(f.rows.get('row-1')).toMatchObject({ latestMessageId: null, latestMessageText: null });
  });
  it.each([apiError(50001, 403), apiError(0, 500), apiError(0, 429)])(
    'does not replace on permission, transient, or rate-limit errors',
    async (error) => {
      const f = fixture();
      f.fetch.mockRejectedValue(error);
      await expect(f.service.ensureThread(serverId, 'ANNOUNCEMENTS')).rejects.toBe(error);
      expect(f.parent.threads.create).not.toHaveBeenCalled();
      expect(f.rows.get('row-1')?.threadId).toBe(threadId);
    },
  );
  it('fails safely when the parent is missing or permissions are denied', async () => {
    const f = fixture([]);
    f.threads.clear();
    f.parent.permissionsFor.mockReturnValue({ has: () => false });
    await expect(f.service.ensureThread(serverId, 'ANNOUNCEMENTS')).rejects.toThrow('permissions');
    expect(f.parent.threads.create).not.toHaveBeenCalled();
    f.fetch.mockRejectedValue(apiError(10003, 404));
    await expect(f.service.ensureThread(serverId, 'ANNOUNCEMENTS')).rejects.toThrow();
  });
  it('only explicitly publishing reopens an archived resource', async () => {
    const f = fixture();
    const thread = f.threads.get(threadId);
    if (!thread) throw new Error('Fixture');
    thread.archived = true;
    await f.service.unarchiveForPublish(serverId, 'ANNOUNCEMENTS');
    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).not.toHaveBeenCalled();
  });
  it('queues recovery on thread deletion', async () => {
    const f = fixture();
    await f.service.handleThreadDelete(threadId);
    expect(f.db.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ type: 'GAME_SERVER_UPDATE_RECONCILE' }),
      }),
    );
  });
});

describe('official updates and expiration', () => {
  it('paginates past member chatter instead of losing an older official entry', async () => {
    const f = fixture();
    await f.service.recordMessage(message('1000'));
    const chatter = new Collection(
      Array.from({ length: 100 }, (_, index) => {
        const id = String(900 - index);
        return [id, message(id, { official: false })] as const;
      }),
    );
    const fetch = f.threads.get(threadId)?.messages.fetch;
    if (fetch === undefined) throw new Error('Fixture');
    fetch
      .mockResolvedValueOnce(chatter)
      .mockResolvedValueOnce(
        new Collection([['700', message('700', { content: 'Older official' })]]),
      );
    await f.service.handleMessageDelete(message('1000'));
    expect(f.rows.get('row-1')?.latestMessageText).toBe('Older official');
    expect(fetch).toHaveBeenLastCalledWith({ limit: 100, before: '801' });
  });

  it('does not overwrite a new post that arrives while deletion history is being fetched', async () => {
    const f = fixture();
    await f.service.recordMessage(message('200'));
    const fetch = f.threads.get(threadId)?.messages.fetch;
    if (fetch === undefined) throw new Error('Fixture');
    fetch.mockImplementationOnce(async () => {
      await f.service.recordMessage(message('300', { content: 'Concurrent new post' }));
      return new Collection([['100', message('100')]]);
    });
    await f.service.handleMessageDelete(message('200'));
    expect(f.rows.get('row-1')).toMatchObject({
      latestMessageId: '300',
      latestMessageText: 'Concurrent new post',
    });
  });

  it('reconciles missed posts and expired badges without reopening threads', async () => {
    const f = fixture();
    const thread = f.threads.get(threadId);
    if (thread === undefined) throw new Error('Fixture');
    thread.archived = true;
    const old = message('200', {
      date: new Date(now.getTime() - NEW_WINDOW_MS - 1000),
      content: 'While offline',
    });
    thread.messages.fetch.mockResolvedValue(new Collection([['200', old]]));
    const result = await f.service.reconcile(serverId);
    expect(result?.rescheduleAt.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    expect(f.rows.get('row-1')).toMatchObject({
      latestMessageText: 'While offline',
      notificationExpiresAt: null,
    });
    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('starts 48 hours from original post time and resets only the posted row', async () => {
    const f = fixture([row(), row({ id: 'row-2', type: 'CHANGELOG', threadId: '200' })]);
    await f.service.recordMessage(message());
    expect(f.rows.get('row-1')).toMatchObject({
      latestMessageText: 'Server is back up!',
      notificationExpiresAt: new Date(now.getTime() + NEW_WINDOW_MS),
    });
    expect(f.rows.get('row-2')?.notificationExpiresAt).toBeNull();
    vi.setSystemTime(new Date(now.getTime() + 3600000));
    await f.service.recordMessage(message('100000000000000101', { date: new Date() }));
    expect(f.rows.get('row-1')?.notificationExpiresAt).toEqual(
      new Date(now.getTime() + 3600000 + NEW_WINDOW_MS),
    );
    expect(
      f.db.job.upsert.mock.calls.filter(
        ([arg]) =>
          (arg as { create: { type: string } }).create.type ===
          'GAME_SERVER_UPDATE_NOTIFICATION_EXPIRE',
      ),
    ).toHaveLength(2);
  });
  it.each([{ official: false }, { bot: true }, { type: MessageType.ThreadStarterMessage }])(
    'ignores members, bots, and system/starter messages',
    async (options) => {
      const f = fixture();
      await f.service.recordMessage(message(undefined, options));
      expect(f.db.gameServerUpdateThread.updateMany).not.toHaveBeenCalled();
      expect(f.db.job.upsert).not.toHaveBeenCalled();
    },
  );
  it('orders out-of-order and same-millisecond posts by snowflake', async () => {
    const f = fixture();
    await f.service.recordMessage(message('200'));
    await f.service.recordMessage(message('100'));
    await f.service.recordMessage(message('201'));
    expect(f.rows.get('row-1')?.latestMessageId).toBe('201');
  });
  it('edits only the latest preview without extending either timer', async () => {
    const f = fixture();
    await f.service.recordMessage(message('200'));
    const before = f.rows.get('row-1')?.notificationExpiresAt;
    vi.setSystemTime(new Date(now.getTime() + 3600000));
    await f.service.recordMessageEdit(message('200', { content: 'Edited' }));
    await f.service.recordMessageEdit(message('199', { content: 'Older' }));
    expect(f.rows.get('row-1')).toMatchObject({
      latestMessageText: 'Edited',
      notificationExpiresAt: before,
    });
  });
  it('ignores an unmanaged partial message without fetching its body', async () => {
    const f = fixture([]);
    const fetch = vi.fn();
    await f.service.recordMessageEdit(Object.assign(message(), { partial: true, fetch }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('restores prior official history using its original deadline', async () => {
    const f = fixture();
    await f.service.recordMessage(message('300'));
    const previous = message('200', {
      date: new Date(now.getTime() - 3600000),
      content: 'Previous',
    });
    f.threads.get(threadId)?.messages.fetch.mockResolvedValue(
      new Collection([
        ['200', previous],
        ['250', message('250', { official: false })],
      ]),
    );
    await f.service.handleMessageDelete(message('300'));
    expect(f.rows.get('row-1')).toMatchObject({
      latestMessageId: '200',
      latestMessageText: 'Previous',
      notificationExpiresAt: new Date(previous.createdTimestamp + NEW_WINDOW_MS),
    });
  });
  it('does not resurrect NEW for old history and clears when history is empty', async () => {
    const f = fixture();
    await f.service.recordMessage(message('300'));
    f.threads
      .get(threadId)
      ?.messages.fetch.mockResolvedValue(
        new Collection([['200', message('200', { date: new Date(now.getTime() - 3 * 86400000) })]]),
      );
    await f.service.handleMessageDelete(message('300'));
    expect(f.rows.get('row-1')?.notificationExpiresAt).toBeNull();
    f.threads.get(threadId)?.messages.fetch.mockResolvedValue(new Collection());
    await f.service.handleMessageDelete(message('200'));
    expect(f.rows.get('row-1')?.latestMessageId).toBeNull();
  });
  it('never clears a newer notification, including a race after loading the deadline', async () => {
    const f = fixture();
    await f.service.recordMessage(message());
    const expected = new Date(now.getTime() + NEW_WINDOW_MS);
    vi.setSystemTime(expected);
    const item = f.rows.get('row-1');
    if (!item) throw new Error('Fixture');
    item.notificationExpiresAt = new Date(expected.getTime() + 1000);
    const payload = {
      gameServerId: serverId,
      threadType: 'ANNOUNCEMENTS' as const,
      expectedExpiresAt: expected.toISOString(),
    };
    await f.service.expireNotification(payload);
    expect(item.notificationExpiresAt).toEqual(new Date(expected.getTime() + 1000));
    item.notificationExpiresAt = expected;
    f.db.gameServerUpdateThread.updateMany.mockImplementationOnce(async () => {
      item.notificationExpiresAt = new Date(expected.getTime() + 2000);
      return { count: 0 };
    });
    await f.service.expireNotification(payload);
    expect(item.notificationExpiresAt).toEqual(new Date(expected.getTime() + 2000));
  });
  it('reschedules early jobs and clears matching due state via a normal card refresh job', async () => {
    const f = fixture();
    await f.service.recordMessage(message());
    const expected = new Date(now.getTime() + NEW_WINDOW_MS);
    const payload = {
      gameServerId: serverId,
      threadType: 'ANNOUNCEMENTS' as const,
      expectedExpiresAt: expected.toISOString(),
    };
    expect(await f.service.expireNotification(payload)).toEqual({ rescheduleAt: expected });
    vi.setSystemTime(expected);
    f.db.job.upsert.mockClear();
    await f.service.expireNotification(payload);
    expect(f.rows.get('row-1')).toMatchObject({
      notificationExpiresAt: null,
      latestMessageText: 'Server is back up!',
    });
    expect(f.db.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ type: 'GAME_SERVER_CARD_REFRESH' }),
      }),
    );
  });
});

describe('preview and identity formatting', () => {
  it('normalizes text, mentions, links, and attachment/empty messages', () => {
    expect(
      normalizeUpdatePreview(
        message('100', {
          content: '**Update**\n\n[Details](https://example.com) <@123> @everyone',
        }),
      ),
    ).toBe('Update Details');
    expect(
      normalizeUpdatePreview({
        content: '',
        attachments: new Collection([['1', {}]]),
      } as unknown as Message),
    ).toBe('📎 Attachment posted');
    expect(normalizeUpdatePreview(message('100', { content: '' }))).toBe('Update posted');
    expect(
      Array.from(normalizeUpdatePreview(message('100', { content: '🎮'.repeat(160) }))),
    ).toHaveLength(140);
  });
  it('keeps identities distinct and recoverable despite duplicate or renamed long display names', () => {
    const name = managedThreadName('A'.repeat(100), serverId, 'ANNOUNCEMENTS');
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toContain(serverId);
    expect(name).toContain('Announcements');
    expect(name).not.toBe(managedThreadName('A'.repeat(100), serverId, 'CHANGELOG'));
  });
});
