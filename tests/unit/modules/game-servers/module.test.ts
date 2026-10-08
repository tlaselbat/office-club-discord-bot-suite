import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { type Client, MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import type { DatHostServerReader } from '../../../../src/integrations/dathost/client.js';
import {
  createGameServersModule,
  type GameServersModuleDependencies,
} from '../../../../src/modules/game-servers/module.js';
import { createGameServerCustomId } from '../../../../src/modules/game-servers/custom-id.js';
import { GameServerUpdateThreadService } from '../../../../src/modules/game-servers/update-thread-service.js';

vi.mock('../../../../src/database/prisma.js', () => ({
  withDatabaseAdvisoryLock: vi.fn(
    async (_prisma: unknown, _key: string, operation: () => Promise<unknown>) => operation(),
  ),
}));

describe('managed update event lifecycle', () => {
  it('registers handlers once, backfills displayed servers through jobs, and removes listeners on stop', async () => {
    const emitter = new EventEmitter();
    const dependencies = mockDependencies({ discord: emitter });
    vi.mocked(dependencies.prisma.gameServer.findMany).mockResolvedValue([
      { id: gameServerId, public: true, cards: [{ id: 'card-1' }] },
      { id: 'hidden', public: false, cards: [{ id: 'card-2' }] },
      { id: 'undisplayed', public: true, cards: [] },
    ] as never);
    const create = vi
      .spyOn(GameServerUpdateThreadService.prototype, 'recordMessage')
      .mockResolvedValue();
    const edit = vi
      .spyOn(GameServerUpdateThreadService.prototype, 'recordMessageEdit')
      .mockResolvedValue();
    const deleted = vi
      .spyOn(GameServerUpdateThreadService.prototype, 'handleMessageDelete')
      .mockResolvedValue();
    const threadDeleted = vi
      .spyOn(GameServerUpdateThreadService.prototype, 'handleThreadDelete')
      .mockResolvedValue();
    const module = createGameServersModule(dependencies);
    await module.start?.();
    await module.start?.();
    expect(emitter.listenerCount('messageCreate')).toBe(1);
    const message = { id: 'post' };
    emitter.emit('messageCreate', message);
    emitter.emit('messageUpdate', {}, message);
    emitter.emit('messageDelete', message);
    emitter.emit('threadDelete', { id: 'thread' });
    expect(create).toHaveBeenCalledWith(message);
    expect(edit).toHaveBeenCalledWith(message);
    expect(deleted).toHaveBeenCalledWith(message);
    expect(threadDeleted).toHaveBeenCalledWith('thread');
    const jobs = vi.mocked(dependencies.prisma.job.upsert).mock.calls.map(([arg]) => arg.create);
    expect(jobs.filter((job) => job.type === 'GAME_SERVER_UPDATE_RECONCILE')).toEqual([
      expect.objectContaining({ payload: { gameServerId } }),
      expect.objectContaining({ payload: { gameServerId } }),
    ]);
    expect(module.jobHandlers?.has('GAME_SERVER_UPDATE_NOTIFICATION_EXPIRE')).toBe(true);
    await module.stop?.();
    expect(emitter.eventNames()).toEqual([]);
  });
});

const secret = 'game-servers-test-secret';
const guildId = '123456789012345678';
const userId = '223456789012345678';
const channelId = '323456789012345678';
const gameServerId = '513af1bb-31fa-4b17-bd2e-2ec450984cea';

function mockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  const base = {
    gameServer: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({
        id: gameServerId,
        guildId,
        providerServerId: 'provider-1',
        displayName: '1v1 Arena',
        description: null,
        enabled: true,
        public: true,
        connectDomain: null,
        joinUrl: null,
        imageUrl: null,
        sortOrder: 0,
        snapshot: null,
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    gameServerCard: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'card-1' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    gameServerSettings: {
      findUnique: vi.fn().mockResolvedValue({
        guildId,
        enabled: true,
        panelChannelId: channelId,
        panelMessageId: null,
      }),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    guildSettings: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    job: { upsert: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (callback: (db: unknown) => Promise<unknown>) => callback(base)),
  };
  return { ...base, ...overrides } as unknown as PrismaClient;
}

function mockDiscord(overrides: Record<string, unknown> = {}): Client {
  const message = { id: 'card-msg-1', edit: vi.fn().mockResolvedValue({}) };
  const channel = {
    id: channelId,
    isTextBased: vi.fn().mockReturnValue(true),
    isDMBased: vi.fn().mockReturnValue(false),
    permissionsFor: vi.fn().mockReturnValue({
      has: vi.fn().mockReturnValue(true),
    }),
    send: vi.fn().mockResolvedValue(message),
    messages: {
      fetch: vi.fn().mockResolvedValue(null),
    },
  };
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    user: { id: 'bot-user' },
    ...overrides,
  } as unknown as Client;
}

function mockDependencies(overrides: Record<string, unknown> = {}) {
  return {
    prisma: mockPrisma(),
    discord: mockDiscord(),
    dathost: {
      getServer: vi.fn().mockResolvedValue(null),
      listServers: vi.fn().mockResolvedValue([]),
      getCsMonitoringMetrics: vi.fn().mockResolvedValue(null),
    } as unknown as DatHostServerReader,
    componentSigningSecret: secret,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as unknown as GameServersModuleDependencies;
}

function componentInteraction(customId: string, values?: string[]) {
  return {
    customId,
    guildId,
    user: { id: userId },
    channel: {
      id: channelId,
      isTextBased: () => true,
      isDMBased: () => false,
      send: vi.fn().mockResolvedValue({ id: 'card-msg-1' }),
    },
    memberPermissions: { has: vi.fn().mockReturnValue(true) as unknown as () => boolean },
    deferReply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    isStringSelectMenu: () => values !== undefined,
    isButton: () => values === undefined,
    values: values ?? [],
  };
}

describe('Game Servers module interactions', () => {
  it('selects a server and updates the same ephemeral Add Server panel', async () => {
    const dependencies = mockDependencies();
    (
      dependencies.prisma.gameServer.findMany as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: gameServerId,
        guildId,
        providerServerId: 'provider-1',
        displayName: '1v1 Arena',
        description: null,
        enabled: true,
        public: true,
        connectDomain: null,
        joinUrl: null,
        imageUrl: null,
        sortOrder: 0,
        snapshot: null,
        cards: [],
      },
    ]);

    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'select', name: channelId, ownerId: userId }, secret),
      [gameServerId],
    );

    await module.handleInteraction?.({ interaction: interaction as never });

    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();

    const replyPayload = ((interaction.editReply as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] ?? {}) as {
      components: [
        { toJSON: () => { components: [{ options?: Array<{ default?: boolean }> }] } },
        { toJSON: () => { components: [{ disabled?: boolean }] } },
      ];
    };

    const selectRow = replyPayload.components[0].toJSON();
    const buttonRow = replyPayload.components[1].toJSON();

    expect(selectRow.components[0].options?.[0]?.default).toBe(true);
    expect(buttonRow.components[0].disabled).toBe(false);
  });

  it('posts the selected server card to the configured channel and dismisses the ephemeral panel', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId(
        { action: 'add', value: gameServerId, name: channelId, ownerId: userId },
        secret,
      ),
    );

    await module.handleInteraction?.({ interaction: interaction as never });

    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
    expect(dependencies.discord.channels.fetch).toHaveBeenCalledWith(channelId);
    expect(dependencies.prisma.gameServerCard.create).toHaveBeenCalledOnce();
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('rejects Add Server without a selection', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'add', ownerId: userId }, secret),
    );

    await module.handleInteraction?.({ interaction: interaction as never });

    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Select a server before pressing Add Server.',
    );
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  it('publishes the selected server to the interaction-selected channel', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId(
        { action: 'add', value: gameServerId, name: channelId, ownerId: userId },
        secret,
      ),
    );

    await module.handleInteraction?.({ interaction: interaction as never });

    expect(interaction.deleteReply).toHaveBeenCalledOnce();
  });

  it('requires Administrator permission to press Add Server', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'add', value: gameServerId, ownerId: userId }, secret),
    );

    interaction.memberPermissions = {
      has: vi
        .fn()
        .mockImplementation(
          (permission: bigint) => permission !== PermissionFlagsBits.Administrator,
        ) as unknown as () => boolean,
    };

    await expect(module.handleInteraction?.({ interaction: interaction as never })).rejects.toThrow(
      'Administrator permission required',
    );
  });

  it('replies with connection information when Connect is pressed without a join URL', async () => {
    const dependencies = mockDependencies({
      prisma: mockPrisma({
        gameServer: {
          findFirst: vi.fn().mockResolvedValue({
            id: gameServerId,
            guildId,
            displayName: '1v1 Arena',
            joinUrl: null,
            snapshot: { host: '192.0.2.1', port: 27015 },
          }),
        },
      }),
    });
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'connect', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('`connect 192.0.2.1:27015`'),
    );
  });

  it('replies with the join URL when Connect is pressed with a configured join URL', async () => {
    const dependencies = mockDependencies({
      prisma: mockPrisma({
        gameServer: {
          findFirst: vi.fn().mockResolvedValue({
            id: gameServerId,
            guildId,
            displayName: '1v1 Arena',
            joinUrl: 'https://example.com/join',
            snapshot: { host: '192.0.2.1', port: 27015 },
          }),
        },
      }),
    });
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'connect', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/join'),
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('`connect 192.0.2.1:27015`'),
    );
  });

  it.each([
    { host: '192.0.2.1', port: 27015, hostingState: 'STOPPED', stale: false },
    { host: '192.0.2.1', port: 27015, hostingState: 'RUNNING', stale: true },
    null,
  ])(
    'keeps known connection instructions accessible despite unavailable or stale telemetry: %j',
    async (snapshot) => {
      const findFirst = vi.fn().mockResolvedValue({
        id: gameServerId,
        guildId,
        displayName: '1v1 Arena',
        connectDomain: 'arena.example.com',
        joinUrl: null,
        snapshot,
      });
      const module = createGameServersModule(
        mockDependencies({ prisma: mockPrisma({ gameServer: { findFirst } }) }),
      );
      const interaction = componentInteraction(
        createGameServerCustomId({ action: 'connect', value: gameServerId }, secret),
      );
      await module.handleInteraction?.({ interaction: interaction as never });
      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining(
          snapshot === null ? '`connect arena.example.com`' : '`connect arena.example.com:27015`',
        ),
      );
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: gameServerId, guildId },
        include: { snapshot: true },
      });
    },
  );

  it('reports an unconfigured address without inventing a console command', async () => {
    const module = createGameServersModule(mockDependencies());
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'connect', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      '**1v1 Arena**\nNo connection address is configured for this server.',
    );
  });

  it('replies with map and rules when Map & Rules is pressed', async () => {
    const dependencies = mockDependencies({
      prisma: mockPrisma({
        gameServer: {
          findFirst: vi.fn().mockResolvedValue({
            id: gameServerId,
            guildId,
            displayName: '1v1 Arena',
            description: 'No toxicity. Knife round enabled.',
            snapshot: { map: 'de_dust2' },
          }),
        },
      }),
    });
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'map-rules', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
    const reply = String(
      (interaction.editReply as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    );
    expect(reply).toContain('de_dust2');
    expect(reply).toContain('No toxicity');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('replies with no-rules message when Map & Rules is pressed without configured rules', async () => {
    const dependencies = mockDependencies({
      prisma: mockPrisma({
        gameServer: {
          findFirst: vi.fn().mockResolvedValue({
            id: gameServerId,
            guildId,
            displayName: '1v1 Arena',
            description: null,
            snapshot: { map: 'de_dust2' },
          }),
        },
      }),
    });
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'map-rules', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No server rules are configured.'),
    );
  });

  it('replies with a copy-friendly address when Copy Address is pressed', async () => {
    const dependencies = mockDependencies({
      prisma: mockPrisma({
        gameServer: {
          findFirst: vi.fn().mockResolvedValue({
            id: gameServerId,
            guildId,
            displayName: '1v1 Arena',
            snapshot: { host: '192.0.2.1', port: 27015 },
          }),
        },
      }),
    });
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'copy-address', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('`192.0.2.1:27015`'),
    );
  });
});
