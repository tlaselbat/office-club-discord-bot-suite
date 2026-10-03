import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import type { DatHostGameServerProvider } from '../../../../src/modules/game-servers/provider.js';
import { GameServerPollService } from '../../../../src/modules/game-servers/poll-service.js';

function prisma(registration: unknown): PrismaClient {
  return {
    gameServer: { findUnique: vi.fn().mockResolvedValue(registration) },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe('GameServerPollService registration state', () => {
  it.each([null, { id: 'one', enabled: false, snapshot: null }])(
    'does not poll missing or disabled registrations',
    async (registration) => {
      const database = prisma(registration);
      const provider = { observe: vi.fn() } as unknown as DatHostGameServerProvider;
      await expect(
        new GameServerPollService(database, provider).poll('one'),
      ).resolves.toBeUndefined();
      expect(provider.observe).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('polls enabled private registrations because visibility does not control telemetry', async () => {
    const transaction = {
      gameServerSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      job: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      gameServer: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'one',
          guildId: 'guild',
          enabled: true,
          public: false,
          providerServerId: 'provider',
          snapshot: null,
        }),
      },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
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
    await expect(new GameServerPollService(database, provider).poll('one')).resolves.toEqual({
      rescheduleAt: expect.any(Date),
    });
    expect(provider.observe).toHaveBeenCalledWith('provider', undefined, expect.any(Date));
    expect(transaction.gameServerSnapshot.upsert).toHaveBeenCalledOnce();
  });
});
