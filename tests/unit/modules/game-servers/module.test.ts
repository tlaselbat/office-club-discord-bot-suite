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
    const replyPayload =
      ((interaction.editReply as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as {
        components: Array<{
          toJSON: () => {
            components: Array<{
              options?: Array<{ default?: boolean }>;
              disabled?: boolean;
            }>;
          };
        }>;
      };
    const components = replyPayload.components.map((row) => row.toJSON());
    expect(components[0].components[0].options?.[0]?.default).toBe(true);
    expect(components[1].components[0].disabled).toBe(false);
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
      has: vi.fn().mockImplementation(
        (permission: bigint) => permission !== PermissionFlagsBits.Administrator,
      ) as unknown as () => boolean,
    };
    await expect(module.handleInteraction?.({ interaction: interaction as never })).rejects.toThrow(
      'Administrator permission required',
    );
  });
});
