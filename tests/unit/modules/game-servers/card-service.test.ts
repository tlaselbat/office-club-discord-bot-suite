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

function createMockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  const base = {
    gameServerCard: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'card-1' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    gameServer: {
      findFirst: vi.fn().mockResolvedValue(serverRecord),
    },
    job: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const merged = {
    ...base,
    ...overrides,
    gameServerCard: { ...base.gameServerCard, ...(overrides.gameServerCard ?? {}) },
  };
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
  } as unknown as Client;
}

function createCard({ fingerprint = { players: 0 } }: { fingerprint?: unknown } = {}) {
  return {
    id: 'card-1',
    guildId: 'guild-1',
    gameServerId: serverView.id,
    channelId: 'channel-1',
    messageId: 'msg-1',
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

describe('GameServerCardService', () => {
  describe('createCard', () => {
    it('creates a Discord message and persists the card registration', async () => {
      const prisma = createMockPrisma();
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret');
      const channel = (await discord.channels.fetch('channel-1')) as unknown as TextBasedChannel;
      await service.createCard(serverView.id, channel);
      const mockSend = (channel as unknown as { send: ReturnType<typeof vi.fn> }).send;
      expect(mockSend).toHaveBeenCalledOnce();
      const createFn = prisma.gameServerCard.create as unknown as ReturnType<typeof vi.fn>;
      expect(createFn).toHaveBeenCalledOnce();
      expect(createFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            guildId: 'guild-1',
            gameServerId: serverView.id,
            channelId: 'channel-1',
            messageId: 'msg-1',
          }),
        }),
      );
    });

    it('rejects duplicate cards for the same configured server', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue({ id: 'existing' }),
        },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret');
      await expect(
        service.createCard(serverView.id, { id: 'channel-1' } as unknown as TextBasedChannel),
      ).rejects.toThrow('A status card for this server has already been added.');
    });

    it('rejects when the configured server is unavailable or not public', async () => {
      const prisma = createMockPrisma({
        gameServer: { findFirst: vi.fn().mockResolvedValue(null) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret');
      await expect(
        service.createCard(serverView.id, { id: 'channel-1' } as unknown as TextBasedChannel),
      ).rejects.toThrow('Selected game server is no longer available or is not public.');
    });
  });

  describe('refreshCard', () => {
    it.each(['layout', 'artwork'])(
      'refreshes older %s on the same message even when server state is unchanged',
      async (change) => {
        const oldFingerprint: Partial<ReturnType<typeof cardFingerprint>> =
          cardFingerprint(serverView);
        if (change === 'layout') oldFingerprint.layoutVersion = 6;
        else
          oldFingerprint.bannerImageUrl =
            'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-banner-old.png';
        const prisma = createMockPrisma({
          gameServerCard: {
            findUnique: vi.fn().mockResolvedValue(createCard({ fingerprint: oldFingerprint })),
          },
        });
        const discord = createMockDiscord();
        const service = new GameServerCardService(prisma, discord, 'secret');
        await service.refreshCard('card-1');
        const channel = await discord.channels.fetch('channel-1');
        const mockChannel = channel as unknown as {
          send: ReturnType<typeof vi.fn>;
          messages: { fetch: ReturnType<typeof vi.fn> };
        };
        expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-1');
        expect(mockChannel.send).not.toHaveBeenCalled();
        expect(prisma.gameServerCard.update).toHaveBeenCalledWith({
          where: { id: 'card-1' },
          data: {
            lastKnownState: cardFingerprint(serverView),
            lastSuccessfulPollAt: serverView.snapshot?.lastSuccessfulAt,
          },
        });
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
      const service = new GameServerCardService(prisma, discord, 'secret');
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
        messages: { fetch: fetchMessages },
      };
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(
            createCard({
              fingerprint: {
                layoutVersion: 7,
                accentColor: 0x2b8aef,
                displayName: '1v1 Arena',
                status: 'Online',
                players: '5 / 16 Players',
                map: 'de_dust2',
                location: 'Los Angeles',
                connectAddress: 'arena.example.com:27015',
                bannerImageUrl:
                  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-banner.png',
                thumbnailImageUrl:
                  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-thumbnail.png',
                hasJoinUrl: false,
              },
            }),
          ),
        },
      });
      const discord = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
      } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret');
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(discord.channels.fetch).not.toHaveBeenCalled();
      expect(fetchMessages).not.toHaveBeenCalled();
    });

    it('removes registration when the Discord message has been deleted', async () => {
      const error = unknownMessageError();
      const fetchMessages = vi.fn().mockRejectedValue(error);
      const channel = {
        id: 'channel-1',
        isTextBased: vi.fn().mockReturnValue(true),
        isDMBased: vi.fn().mockReturnValue(false),
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
      const service = new GameServerCardService(prisma, discord, 'secret');
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(prisma.gameServerCard.delete).toHaveBeenCalledOnce();
    });

    it('removes registration when the channel is inaccessible', async () => {
      const prisma = createMockPrisma({
        gameServerCard: {
          findUnique: vi.fn().mockResolvedValue(createCard()),
          delete: vi.fn().mockResolvedValue({}),
        },
      });
      const discord = { channels: { fetch: vi.fn().mockResolvedValue(null) } } as unknown as Client;
      const service = new GameServerCardService(prisma, discord, 'secret');
      const result = await service.refreshCard('card-1');
      expect(result).toBeUndefined();
      expect(prisma.gameServerCard.delete).toHaveBeenCalledOnce();
    });

    it('does nothing when the card registration is missing', async () => {
      const prisma = createMockPrisma({
        gameServerCard: { findUnique: vi.fn().mockResolvedValue(null) },
      });
      const discord = createMockDiscord();
      const service = new GameServerCardService(prisma, discord, 'secret');
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
      const service = new GameServerCardService(prisma, discord, 'secret');
      const before = Date.now();
      const result = await service.refreshCard('card-1');
      expect(result).toEqual({ rescheduleAt: expect.any(Date) });
      expect(result?.rescheduleAt.getTime()).toBeGreaterThanOrEqual(before + 2_000);
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
      const service = new GameServerCardService(prisma, discord, 'secret');
      await service.refreshCardsForGameServer(serverView.id);
      expect(prisma.job.upsert).toHaveBeenCalledTimes(2);
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
