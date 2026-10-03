import { describe, expect, it, vi } from 'vitest';
import { type Client, PermissionFlagsBits } from 'discord.js';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import type { DatHostServerReader } from '../../../../src/integrations/dathost/client.js';
import {
  createGameServersModule,
  type GameServersModuleDependencies,
} from '../../../../src/modules/game-servers/module.js';
import { createGameServerCustomId } from '../../../../src/modules/game-servers/custom-id.js';

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
        panelMessageId: 'panel-msg-1',
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
    send: vi.fn().mockResolvedValue(message),
    messages: {
      fetch: vi.fn().mockResolvedValue({
        id: 'panel-msg-1',
        edit: vi.fn().mockResolvedValue({}),
      }),
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
    update: vi.fn().mockResolvedValue(undefined),
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    isStringSelectMenu: () => values !== undefined,
    isButton: () => values === undefined,
    values: values ?? [],
  };
}

describe('Game Servers module interactions', () => {
  it('selects a server and updates the Add Server panel', async () => {
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
      },
    ]);
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'select' }, secret),
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

  it('adds a server card when Add Server is pressed with a selection', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'add', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
    expect(dependencies.prisma.gameServerCard.create).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledWith('Server status card added.');
  });

  it('rejects Add Server without a selection', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(createGameServerCustomId({ action: 'add' }, secret));
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Select a server before pressing Add Server.',
    );
  });

  it('rejects duplicate cards for the same server', async () => {
    const dependencies = mockDependencies();
    (
      dependencies.prisma.gameServerCard.findUnique as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'existing' });
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'add', value: gameServerId }, secret),
    );
    await module.handleInteraction?.({ interaction: interaction as never });
    expect(interaction.editReply).toHaveBeenCalledWith(
      'A status card for this server has already been added.',
    );
  });

  it('requires Administrator permission to press Add Server', async () => {
    const dependencies = mockDependencies();
    const module = createGameServersModule(dependencies);
    const interaction = componentInteraction(
      createGameServerCustomId({ action: 'add', value: gameServerId }, secret),
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
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('192.0.2.1:27015'));
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
});
