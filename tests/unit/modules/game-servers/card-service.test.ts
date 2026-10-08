import { describe, expect, it, vi } from 'vitest';
import { DiscordAPIError, type Client, type TextBasedChannel } from 'discord.js';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import {
  GameServerCardService,
  scheduleGameServerCardRefresh,
} from '../../../../src/modules/game-servers/card-service.js';
import type { ServerView } from '../../../../src/modules/game-servers/renderer.js';
import { cardFingerprint } from '../../../../src/modules/game-servers/renderer.js';

const serverView: ServerView = {
  guildId: 'guild-1',
  id: '513af1bb-31fa-4b17-bd2e-2ec450984cea',
  providerServerId: 'provider-1',
  displayName: '1v1 Arena',
  description: null,
  enabled: true,
  public: true,
  connectDomain: 'arena.example.com',
  joinUrl: null,
  imageUrl: null,
  sortOrder: 0,
  snapshot: {
    hostingState: 'RUNNING',
    gameplayState: 'AVAILABLE',
    host: '192.0.2.1',
    hostname: '1v1 Arena',
    port: 27015,
    datacenter: 'Los Angeles',
    map: 'de_dust2',
    players: 5,
    maxPlayers: 16,
    cpuPercent: 10,
    memoryUsageMb: 512,
    averagePingMs: 31,
    packetLossPercent: 0,
    serverVarMs: 0.5,
    observedAt: new Date('2026-10-03T00:00:00.000Z'),
    monitoringObservedAt: new Date('2026-10-03T00:00:00.000Z'),
    lastSuccessfulAt: new Date('2026-10-03T00:00:00.000Z'),
    lastOnlineAt: new Date('2026-10-03T00:00:00.000Z'),
    stale: false,
  },
};

const serverRecord = { ...serverView, guildId: 'guild-1' };
const immediateLock = async <T>(_key: string, operation: () => Promise<T>): Promise<T> =>
  operation();

function createMockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  const base = {
    gameServerCard: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'card-1' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    gameServer: {
      findFirst: vi.fn().mockResolvedValue(serverRecord),
    },
    gameServerSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    job: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const merged = {
    ...base,
    ...overrides,
    gameServerCard: { ...base.gameServerCard, ...(overrides.gameServerCard ?? {}) },
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
  Object.assign(merged, {
    $transaction: vi.fn(async (callback: (transaction: typeof merged) => Promise<unknown>) =>
      callback(merged),
    ),
  });
  return merged as unknown as PrismaClient;
}

function createMockDiscord({ messageExists = true } = {}): Client {
  const message = {
    id: 'msg-1',
    edit: vi.fn().mockResolvedValue({}),
  };
  const channel = {
    id: 'channel-1',
    isTextBased: vi.fn().mockReturnValue(true),
    isDMBased: vi.fn().mockReturnValue(false),
    send: vi.fn().mockResolvedValue(message),
    messages: { fetch: vi.fn().mockResolvedValue(messageExists ? message : null) },
  };
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    user: { id: 'bot-1' },
  } as unknown as Client;
}

function createCard({ fingerprint = { players: 0 } }: { fingerprint?: unknown } = {}) {
  return {
    id: 'card-1',
    guildId: 'guild-1',
    gameServerId: serverView.id,
    channelId: 'channel-1',
    messageId: 'msg-1',
    state: 'HEALTHY',
    lastKnownState: fingerprint,
    lastSuccessfulPollAt: null,
    gameServer: serverRecord,
  };
}

function unknownMessageError(): DiscordAPIError {
  return new DiscordAPIError(
    { message: 'Unknown Message', code: 10_008 },
    10_008,
    404,
    'GET',
    'https://discord.com/api/channels/channel-1/messages/msg-1',
    { body: undefined, files: undefined } as unknown as never,
  );
}

function unknownChannelError(): DiscordAPIError {
  return new DiscordAPIError(
    { message: 'Unknown Channel', code: 10_003 },
    10_003,
    404,
    'GET',
    'https://discord.com/api/channels/channel-1',
    { body: undefined, files: undefined } as unknown as never,
  );
}

describe('GameServerCardService', () => {
  describe('publishDeployment', () => {
    it('serializes publication and returns the persisted message id', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi
            .fn()
            .mockResolvedValue({ id: 'card-1', channelId: 'channel-1', messageId: null }),
          findUnique: vi
            .fn()
            .mockResolvedValue({ ...createCard(), messageId: 'persisted-message' }),
        },
      });
      const discord = createMockDiscord();
      const lockKeys: string[] = [];
      const lock = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
        lockKeys.push(key);
        return operation();
      };
      const service = new GameServerCardService(prisma, discord, 'secret', lock);
      const channel = (await discord.channels.fetch('channel-1')) as unknown as TextBasedChannel;

      await expect(service.publishDeployment(serverView.id, channel)).resolves.toMatchObject({
        id: 'card-1',
        channelId: 'channel-1',
        messageId: 'persisted-message',
      });
      expect(lockKeys).toEqual([`game-server-card:${serverView.id}`]);
    });
    it('deletes a newly sent bot message if card persistence fails', async () => {
      const message = {
        id: 'msg-new',
        author: { id: 'bot-1' },
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const channel = {
        id: 'channel-1',
        isTextBased: () => true,
        isDMBased: () => false,
        send: vi.fn().mockResolvedValue(message),
      };
      const prisma = createMockPrisma({
        gameServerCard: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi
            .fn()
            .mockResolvedValue({ id: 'card-1', channelId: 'channel-1', messageId: null }),
          findUnique: vi.fn().mockResolvedValue({ ...createCard(), messageId: null }),
          update: vi.fn().mockRejectedValue(new Error('db unavailable')),
        },
      });
      const discord = {
        user: { id: 'bot-1' },
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      await expect(
        new GameServerCardService(prisma, discord, 'secret', immediateLock).publishDeployment(
          serverView.id,
          channel as unknown as TextBasedChannel,
        ),
      ).rejects.toThrow('db unavailable');
      expect(message.delete).toHaveBeenCalledOnce();
    });
    it('creates a Discord message and persists the card registration', async () => {
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const channel = (await discord.channels.fetch('channel-1')) as unknown as TextBasedChannel;
      await service.publishDeployment(serverView.id, channel);
      const mockSend = (channel as unknown as { send: ReturnType<typeof vi.fn> }).send;
      expect(mockSend).not.toHaveBeenCalled();
      expect(
        (channel as unknown as { messages: { fetch: ReturnType<typeof vi.fn> } }).messages.fetch,
      ).toHaveBeenCalledWith('msg-1');
      const createFn = prisma.gameServerCard.create as unknown as ReturnType<typeof vi.fn>;
      expect(createFn).toHaveBeenCalledOnce();
      expect(createFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            guildId: 'guild-1',
            gameServerId: serverView.id,
            channelId: 'channel-1',
            messageId: null,
            state: 'CREATING',
          }),
        }),
      );
    });

    it('allows deployments in separate channels for the same server', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(createCard()),
        },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      await service.publishDeployment(serverView.id, {
        id: 'channel-2',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
        send: vi.fn().mockResolvedValue({ id: 'msg-2' }),
        messages: { fetch: vi.fn().mockResolvedValue(null) },
      } as unknown as TextBasedChannel);
      expect(prisma.gameServerCard.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channelId: 'channel-2' }) }),
      );
    });

    it('does not duplicate an existing healthy deployment in the same channel', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'card-1',
            channelId: 'channel-1',
            messageId: 'msg-1',
          }),
          findUnique: vi
            .fn()
            .mockResolvedValue(createCard({ fingerprint: cardFingerprint(serverView) })),
        },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const channel = (await discord.channels.fetch('channel-1')) as unknown as TextBasedChannel;

      await service.publishDeployment(serverView.id, channel);

      expect(prisma.gameServerCard.create).not.toHaveBeenCalled();
      expect(
        (channel as unknown as { send: ReturnType<typeof vi.fn> }).send,
      ).not.toHaveBeenCalled();
    });

    it('rejects when the configured server is unavailable or not public', async () => {
      const prisma = createMockPrisma({
        gameServer: { findFirst: vi.fn().mockResolvedValue(null) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      await expect(
        service.publishDeployment(serverView.id, {
          id: 'channel-1',
        } as unknown as TextBasedChannel),
      ).rejects.toThrow('Selected game server is no longer available or is not public.');
    });

    it('rejects publication when the Game Servers module is explicitly disabled', async () => {
      const prisma = createMockPrisma({
        gameServerSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: false }) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const channel = (await discord.channels.fetch('channel-1')) as unknown as TextBasedChannel;

      await expect(service.publishDeployment(serverView.id, channel)).rejects.toMatchObject({
        code: 'GAME_SERVER_MODULE_DISABLED',
      });
      expect(prisma.gameServerCard.create).not.toHaveBeenCalled();
      expect(
        (channel as unknown as { send: ReturnType<typeof vi.fn> }).send,
      ).not.toHaveBeenCalled();
    });
  });

  describe('refreshCard', () => {
    it('preserves a public deployment and skips Discord I/O when the module is disabled', async () => {
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
        gameServerSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: false }) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await expect(service.refreshCard('card-1')).resolves.toBeUndefined();
      expect(discord.channels.fetch).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
    });

    it('removes a private server deployment during refresh', async () => {
      const message = {
        id: 'msg-1',
        author: { id: 'bot-1' },
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const channel = {
        id: 'channel-1',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
        messages: { fetch: vi.fn().mockResolvedValue(message) },
      };
      const disabledCard = {
        ...createCard(),
        gameServer: { ...serverRecord, public: false },
      };
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(disabledCard) },
      });
      const discord = {
        user: { id: 'bot-1' },
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await expect(service.refreshCard('card-1')).resolves.toBeUndefined();
      expect(message.delete).toHaveBeenCalledOnce();
      expect(prisma.gameServerCard.delete).toHaveBeenCalledWith({ where: { id: 'card-1' } });
      expect(prisma.gameServerCard.update).not.toHaveBeenCalled();
    });

    it('preserves a disabled server deployment during refresh', async () => {
      const disabledCard = {
        ...createCard(),
        gameServer: { ...serverRecord, enabled: false },
      };
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(disabledCard) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await expect(service.refreshCard('card-1')).resolves.toBeUndefined();
      expect(discord.channels.fetch).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).not.toHaveBeenCalled();
    });

    it.each(['layout', 'artwork'])(
      'refreshes older %s on the same message even when server state is unchanged',
      async (change) => {
        const oldFingerprint: Partial<ReturnType<typeof cardFingerprint>> =
          cardFingerprint(serverView);
        if (change === 'layout') oldFingerprint.layoutVersion = 14;
        else
          oldFingerprint.bannerImageUrl =
            'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-banner-old.png';
        const prisma = createMockPrisma({
          gameServerCard: {
            findUnique: vi.fn().mockResolvedValue(createCard({ fingerprint: oldFingerprint })),
          },
        });
        const discord = createMockDiscord();
        const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
        await service.refreshCard('card-1');
        const channel = await discord.channels.fetch('channel-1');
        const mockChannel = channel as unknown as {
          send: ReturnType<typeof vi.fn>;
          messages: { fetch: ReturnType<typeof vi.fn> };
        };
        expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-1');
        expect(mockChannel.send).not.toHaveBeenCalled();
        expect(prisma.gameServerCard.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'card-1' },
            data: expect.objectContaining({
              state: 'HEALTHY',
              lastKnownState: cardFingerprint(serverView),
              lastSuccessfulPollAt: serverView.snapshot?.lastSuccessfulAt,
            }),
          }),
        );
      },
    );

    it('edits the Discord message when visible state has changed', async () => {
      const message = { id: 'msg-1', edit: vi.fn().mockResolvedValue({}) };
      const fetchMessages = vi.fn().mockResolvedValue(message);
      const channel = {
        id: 'channel-1',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
        messages: { fetch: fetchMessages },
      };
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(createCard()),
        },
      });
      const discord = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(fetchMessages).toHaveBeenCalledWith('msg-1');
      expect(message.edit).toHaveBeenCalledOnce();
      expect(prisma.gameServerCard.update).toHaveBeenCalledOnce();
    });

    it('skips Discord edits when visible state is unchanged', async () => {
      const message = { id: 'msg-1', edit: vi.fn().mockResolvedValue({}) };
      const fetchMessages = vi.fn().mockResolvedValue(message);
      const channel = {
        id: 'channel-1',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
        send: vi.fn().mockResolvedValue({ id: 'recreated-1' }),
        messages: { fetch: fetchMessages },
      };
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(
            createCard({
              fingerprint: cardFingerprint(serverView),
            }),
          ),
        },
      });
      const discord = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(discord.channels.fetch).not.toHaveBeenCalled();
      expect(fetchMessages).not.toHaveBeenCalled();
    });

    it('recreates a desired deployment when the Discord message has been deleted', async () => {
      const error = unknownMessageError();
      const fetchMessages = vi.fn().mockRejectedValue(error);
      const channel = {
        id: 'channel-1',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
        send: vi.fn().mockResolvedValue({ id: 'recreated-1' }),
        messages: { fetch: fetchMessages },
      };
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(createCard()),
          delete: vi.fn().mockResolvedValue({}),
        },
      });
      const discord = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'MISSING', messageId: null }),
        }),
      );
    });

    it('marks the desired deployment missing when the channel is inaccessible', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(createCard()),
          delete: vi.fn().mockResolvedValue({}),
        },
      });
      const discord = { channels: { fetch: vi.fn().mockResolvedValue(null) } } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'MISSING' }) }),
      );
    });

    it('does nothing when the card registration is missing', async () => {
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(null) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(discord.channels.fetch).not.toHaveBeenCalled();
    });

    it('reschedules using retry_after when Discord returns a rate limit', async () => {
      const error = new DiscordAPIError(
        { message: 'rate limited', retry_after: 2.5, code: 0 } as unknown as never,
        0,
        429,
        'PATCH',
        'https://discord.com/api/channels/channel-1/messages/msg-1',
        { body: undefined, files: undefined } as unknown as never,
      );
      const message = { id: 'msg-1', edit: vi.fn().mockRejectedValue(error) };
      const fetchMessages = vi.fn().mockResolvedValue(message);
      const channel = {
        id: 'channel-1',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
        messages: { fetch: fetchMessages },
      };
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(createCard()),
        },
      });
      const discord = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      const before = Date.now();
      const result = await service.refreshCard('card-1');
      expect(result).toEqual({ rescheduleAt: expect.any(Date) });
      expect(result?.rescheduleAt.getTime()).toBeGreaterThanOrEqual(before + 2_000);
    });
  });

  describe('removeDeployment', () => {
    it('retains the deployment and marks an actionable error when message fetch fails', async () => {
      const failure = new Error('Discord temporarily unavailable');
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
      });
      const discord = createMockDiscord();
      const channel = await discord.channels.fetch('channel-1');
      (
        channel as unknown as { messages: { fetch: ReturnType<typeof vi.fn> } }
      ).messages.fetch.mockRejectedValue(failure);
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await expect(service.removeDeployment('card-1')).rejects.toThrow(
        'Discord temporarily unavailable',
      );
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'ERROR' }) }),
      );
    });

    it('removes a deployment after Discord confirms its managed message is unknown', async () => {
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
      });
      const discord = createMockDiscord();
      const channel = await discord.channels.fetch('channel-1');
      (
        channel as unknown as { messages: { fetch: ReturnType<typeof vi.fn> } }
      ).messages.fetch.mockRejectedValue(unknownMessageError());
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await service.removeDeployment('card-1');
      expect(prisma.gameServerCard.delete).toHaveBeenCalledWith({ where: { id: 'card-1' } });
    });

    it('does not delete a message authored by another Discord user', async () => {
      const message = { id: 'msg-1', author: { id: 'other-user' }, delete: vi.fn() };
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
      });
      const discord = createMockDiscord();
      const channel = await discord.channels.fetch('channel-1');
      (
        channel as unknown as { messages: { fetch: ReturnType<typeof vi.fn> } }
      ).messages.fetch.mockResolvedValue(message);
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await expect(service.removeDeployment('card-1')).rejects.toThrow(
        'no longer authored by this bot',
      );
      expect(message.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'ERROR' }) }),
      );
    });

    it('removes the deployment when Discord confirms its channel no longer exists', async () => {
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
      });
      const discord = {
        channels: { fetch: vi.fn().mockRejectedValue(unknownChannelError()) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await service.removeDeployment('card-1');
      expect(prisma.gameServerCard.delete).toHaveBeenCalledWith({ where: { id: 'card-1' } });
    });

    it('retains and marks the deployment when Discord cannot delete its managed message', async () => {
      const failure = new Error('Discord delete forbidden');
      const message = {
        id: 'msg-1',
        author: { id: 'bot-1' },
        delete: vi.fn().mockRejectedValue(failure),
      };
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(createCard()) },
      });
      const discord = createMockDiscord();
      const channel = await discord.channels.fetch('channel-1');
      (
        channel as unknown as { messages: { fetch: ReturnType<typeof vi.fn> } }
      ).messages.fetch.mockResolvedValue(message);
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);

      await expect(service.removeDeployment('card-1')).rejects.toThrow('Discord delete forbidden');
      expect(prisma.gameServerCard.delete).not.toHaveBeenCalled();
      expect(prisma.gameServerCard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'ERROR' }) }),
      );
    });
  });

  describe('refreshCardsForGameServer', () => {
    it('schedules a refresh job for each registered card', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findMany: vi.fn().mockResolvedValue([{ id: 'card-1' }, { id: 'card-2' }]),
        },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret', immediateLock);
      await service.refreshCardsForGameServer(serverView.id);
      expect(prisma.job.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeDeploymentsForGameServer', () => {
    it('runs registration cleanup while the server lifecycle lock is held', async () => {
      const events: string[] = [];
      const lock = async <T>(_key: string, operation: () => Promise<T>): Promise<T> => {
        events.push('lock');
        try {
          return await operation();
        } finally {
          events.push('unlock');
        }
      };
      const prisma = createMockPrisma({
        gameServerCard: { findMany: vi.fn().mockResolvedValue([]) },
      });
      const service = new GameServerCardService(prisma, createMockDiscord(), 'secret', lock);

      await service.removeDeploymentsForGameServer(serverView.id, async () => {
        events.push('after-removal');
      });

      expect(events).toEqual(['lock', 'after-removal', 'unlock']);
    });
  });
});

describe('scheduleGameServerCardRefresh', () => {
  it('upserts a card refresh job', async () => {
    const prisma = { job: { upsert: vi.fn().mockResolvedValue({}) } } as unknown as PrismaClient;
    await scheduleGameServerCardRefresh(prisma, 'card-1');
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'game-server:card:card-1' },
        update: expect.any(Object),
        create: expect.objectContaining({
          type: 'GAME_SERVER_CARD_REFRESH',
          payload: { cardId: 'card-1' },
        }),
      }),
    );
  });
});
