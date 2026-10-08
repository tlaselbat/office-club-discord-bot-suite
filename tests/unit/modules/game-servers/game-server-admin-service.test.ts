import { describe, expect, it, vi } from 'vitest';
import { GameServerAdminService } from '../../../../src/modules/game-servers/services/game-server-admin-service.js';

describe('GameServerAdminService toggle CAS', () => {
  it('rejects a lost CAS without writing a success audit', async () => {
    const tx = {
      gameServer: {
        findFirst: vi.fn().mockResolvedValue({ id: 'server-1', guildId: 'guild-1', version: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {} as never,
    });
    await expect(
      service.setServerEnabled({
        guildId: 'guild-1',
        gameServerId: 'server-1',
        expectedVersion: 2,
        enabled: false,
        actorDiscordUserId: 'user-1',
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONFIGURATION' });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('GameServerAdminService card configuration', () => {
  it('creates first module settings from legacy version zero and schedules enabled servers', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      gameServerSettings: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      guildSettings: { upsert: vi.fn() },
      gameServer: { findMany: vi.fn().mockResolvedValue([{ id: 'server-1', public: true }]) },
      gameServerCard: { findMany: vi.fn().mockResolvedValue([{ id: 'card-1' }]) },
      job: { upsert: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {} as never,
    });
    await service.setModuleEnabled({
      guildId: 'guild-1',
      enabled: true,
      expectedVersion: 0,
      actorDiscordUserId: 'user-1',
      correlationId: 'corr-1',
    });
    expect(tx.gameServerSettings.create).toHaveBeenCalledWith({
      data: { guildId: 'guild-1', enabled: true, version: 1 },
    });
    expect(tx.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'game-server:card:card-1:module:1' },
      }),
    );
  });

  it('rejects a second legacy-version-zero module mutation after settings exist', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      gameServerSettings: { findUnique: vi.fn().mockResolvedValue({ version: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {} as never,
    });
    await expect(
      service.setModuleEnabled({
        guildId: 'guild-1',
        enabled: false,
        expectedVersion: 0,
        actorDiscordUserId: 'user-1',
        correlationId: 'corr-2',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONFIGURATION' });
  });

  it('writes an output refresh job in the update transaction', async () => {
    const tx = {
      gameServer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'server-1',
          guildId: 'guild-1',
          version: 2,
          enabled: true,
          public: true,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gameServerCard: { findMany: vi.fn().mockResolvedValue([{ id: 'card-1' }]) },
      job: { upsert: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {} as never,
    });
    await service.updateServer({
      guildId: 'guild-1',
      gameServerId: 'server-1',
      expectedVersion: 2,
      actorDiscordUserId: 'user-1',
      correlationId: 'corr-1',
      cardProfile: {
        accentColor: '#123456',
        thumbnailImageUrl: null,
        onlineEmojiId: null,
        offlineEmojiId: null,
        warningEmojiId: null,
        pendingEmojiId: null,
      },
    });
    expect(tx.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'game-server:card:card-1:config:3' },
      }),
    );
  });

  it('rejects publishing a server outside the command guild before Discord I/O', async () => {
    const prisma = { gameServer: { findFirst: vi.fn().mockResolvedValue(null) } } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: { guilds: { fetch: vi.fn() } } as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: { publishDeployment: vi.fn() } as never,
    });
    await expect(
      service.publishServerCard({
        guildId: 'guild-1',
        gameServerId: 'other-guild-server',
        channelId: 'channel-1',
        actorDiscordUserId: 'user-1',
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: 'GAME_SERVER_NOT_FOUND' });
    expect(
      (service as unknown as { cardService: { publishDeployment: ReturnType<typeof vi.fn> } })
        .cardService.publishDeployment,
    ).not.toHaveBeenCalled();
  });

  it('durably refreshes an existing card when a profile saved while disabled is re-enabled', async () => {
    const tx = {
      gameServer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'server-1',
          guildId: 'guild-1',
          version: 5,
          enabled: false,
          public: true,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gameServerCard: { findMany: vi.fn().mockResolvedValue([{ id: 'card-1' }]) },
      job: { upsert: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {} as never,
    });
    await service.updateServer({
      guildId: 'guild-1',
      gameServerId: 'server-1',
      expectedVersion: 5,
      actorDiscordUserId: 'user-1',
      correlationId: 'corr-1',
      enabled: true,
    });
    expect(tx.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'game-server:card:card-1:eligible:6' },
      }),
    );
  });

  it('queues privacy cleanup before the post-commit display removal', async () => {
    const tx = {
      gameServer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'server-1',
          guildId: 'guild-1',
          version: 8,
          enabled: true,
          public: true,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gameServerCard: { findMany: vi.fn().mockResolvedValue([{ id: 'card-1' }]) },
      job: { upsert: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const removeDeploymentsForGameServer = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: { removeDeploymentsForGameServer } as never,
    });
    await service.updateServer({
      guildId: 'guild-1',
      gameServerId: 'server-1',
      expectedVersion: 8,
      actorDiscordUserId: 'user-1',
      correlationId: 'corr-1',
      public: false,
    });
    expect(tx.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'game-server:card:card-1:privacy:9' },
      }),
    );
    expect(removeDeploymentsForGameServer).toHaveBeenCalledWith('server-1');
  });

  it('deletes a registration only through the lifecycle cleanup callback', async () => {
    const tx = {
      gameServer: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: 'server-1' }).mockResolvedValueOnce({
          id: 'server-1',
          guildId: 'guild-1',
          displayName: 'Arena',
          providerServerId: 'provider-1',
        }),
        delete: vi.fn(),
      },
      auditEvent: { create: vi.fn() },
    };
    const order: string[] = [];
    const removeDeploymentsForGameServer = vi.fn(
      async (_id: string, afterRemoval: () => Promise<void>) => {
        order.push('cleanup');
        expect(tx.gameServer.delete).not.toHaveBeenCalled();
        await afterRemoval();
        order.push('unregistered');
      },
    );
    const prisma = {
      gameServer: { findFirst: tx.gameServer.findFirst },
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: { removeDeploymentsForGameServer } as never,
    });
    await service.removeServerRegistration({
      guildId: 'guild-1',
      gameServerId: 'server-1',
      actorDiscordUserId: 'user-1',
      correlationId: 'corr-1',
    });
    expect(order).toEqual(['cleanup', 'unregistered']);
    expect(tx.gameServer.delete).toHaveBeenCalledWith({ where: { id: 'server-1' } });
  });

  it('does not unregister when lifecycle cleanup fails', async () => {
    const deleteRegistration = vi.fn();
    const transaction = vi.fn();
    const prisma = {
      gameServer: { findFirst: vi.fn().mockResolvedValue({ id: 'server-1' }) },
      $transaction: transaction,
    };
    const service = new GameServerAdminService({
      prisma: prisma as never,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {
        removeDeploymentsForGameServer: vi.fn().mockRejectedValue(new Error('Discord unavailable')),
      } as never,
    });
    await expect(
      service.removeServerRegistration({
        guildId: 'guild-1',
        gameServerId: 'server-1',
        actorDiscordUserId: 'user-1',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrow('Discord unavailable');
    expect(deleteRegistration).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
