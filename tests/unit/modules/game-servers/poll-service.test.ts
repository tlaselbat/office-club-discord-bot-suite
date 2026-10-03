import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import type { GameServerCardService } from '../../../../src/modules/game-servers/card-service.js';
import type { DatHostGameServerProvider } from '../../../../src/modules/game-servers/provider.js';
import { GameServerPollService } from '../../../../src/modules/game-servers/poll-service.js';

function createMockPrisma(registration: unknown, transaction?: unknown): PrismaClient {
  return {
    gameServer: { findUnique: vi.fn().mockResolvedValue(registration) },
    $transaction: vi.fn(async (callback) =>
      typeof callback === 'function' ? callback(transaction ?? {}) : Promise.resolve(),
    ),
  } as unknown as PrismaClient;
}

function createCardService(): GameServerCardService {
  return {
    refreshCardsForGameServer: vi.fn().mockResolvedValue(undefined),
  } as unknown as GameServerCardService;
}

describe('GameServerPollService registration state', () => {
  it.each([null, { id: 'one', enabled: false, snapshot: null }])(
    'does not poll missing or disabled registrations',
    async (registration) => {
      const database = createMockPrisma(registration);
      const provider = { observe: vi.fn() } as unknown as DatHostGameServerProvider;
      const cards = createCardService();
      await expect(
        new GameServerPollService(database, provider, cards).poll('one'),
      ).resolves.toBeUndefined();
      expect(provider.observe).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(cards.refreshCardsForGameServer).not.toHaveBeenCalled();
    },
  );

  it('polls enabled private registrations because visibility does not control telemetry', async () => {
    const transaction = {
      gameServerSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      job: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const database = createMockPrisma(
      {
        id: 'one',
        guildId: 'guild',
        enabled: true,
        public: false,
        providerServerId: 'provider',
        snapshot: null,
      },
      transaction,
    );
    const provider = {
      observe: vi.fn().mockResolvedValue({
        hostingState: 'RUNNING',
        gameplayState: 'AVAILABLE',
        host: '192.0.2.1',
        rawIp: '192.0.2.1',
        port: 27015,
        datacenter: null,
        hostname: 'Arena',
        map: null,
        players: 0,
        maxPlayers: 16,
        playerCountSource: 'DATHOST_MONITORING',
        cpuPercent: null,
        memoryUsageMb: null,
        averagePingMs: null,
        packetLossPercent: null,
        serverVarMs: null,
        connectedSteamIds: [],
        serverSource: true,
        monitoringSource: true,
        serverObservedAt: new Date(),
        monitoringObservedAt: new Date(),
        observedAt: new Date(),
      }),
    } as unknown as DatHostGameServerProvider;
    const cards = createCardService();
    await expect(new GameServerPollService(database, provider, cards).poll('one')).resolves.toEqual(
      {
        rescheduleAt: expect.any(Date),
      },
    );
    expect(provider.observe).toHaveBeenCalledWith('provider', undefined, expect.any(Date));
    expect(transaction.gameServerSnapshot.upsert).toHaveBeenCalledOnce();
    expect(cards.refreshCardsForGameServer).toHaveBeenCalledWith('one');
  });

  it('schedules card refreshes after every successful poll', async () => {
    const previousSnapshot = {
      hostingState: 'RUNNING',
      gameplayState: 'AVAILABLE',
      host: '192.0.2.1',
      port: 27015,
      datacenter: 'Los Angeles',
      map: 'de_dust2',
      players: 5,
      maxPlayers: 16,
      cpuPercent: 10,
      memoryUsageMb: 512,
      averagePingMs: 30,
      packetLossPercent: 0,
      serverVarMs: 0.5,
      stale: false,
      consecutiveFailures: 0,
    };
    const transaction = {
      gameServerSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      job: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const database = createMockPrisma(
      {
        id: 'one',
        guildId: 'guild',
        enabled: true,
        public: true,
        providerServerId: 'provider',
        snapshot: previousSnapshot,
      },
      transaction,
    );
    const provider = {
      observe: vi.fn().mockResolvedValue({
        ...previousSnapshot,
        rawIp: '192.0.2.1',
        hostname: 'Arena',
        playerCountSource: 'DATHOST_MONITORING',
        connectedSteamIds: [],
        serverSource: true,
        monitoringSource: true,
        serverObservedAt: new Date(),
        monitoringObservedAt: new Date(),
        observedAt: new Date(),
      }),
    } as unknown as DatHostGameServerProvider;
    const cards = createCardService();
    await new GameServerPollService(database, provider, cards).poll('one');
    expect(cards.refreshCardsForGameServer).toHaveBeenCalledWith('one');
  });

  it('refreshes cards when DatHost polling fails and state degrades', async () => {
    const transaction = {
      gameServerSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      job: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const database = createMockPrisma(
      {
        id: 'one',
        guildId: 'guild',
        enabled: true,
        public: true,
        providerServerId: 'provider',
        snapshot: {
          hostingState: 'RUNNING',
          gameplayState: 'AVAILABLE',
          consecutiveFailures: 0,
        },
      },
      transaction,
    );
    const provider = {
      observe: vi.fn().mockRejectedValue(new Error('DatHost unreachable')),
    } as unknown as DatHostGameServerProvider;
    const cards = createCardService();
    await expect(new GameServerPollService(database, provider, cards).poll('one')).resolves.toEqual(
      { rescheduleAt: expect.any(Date) },
    );
    expect(transaction.gameServerSnapshot.upsert).toHaveBeenCalledOnce();
    expect(cards.refreshCardsForGameServer).toHaveBeenCalledWith('one');
  });
});
