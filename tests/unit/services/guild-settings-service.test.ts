import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { GuildSettingsService } from '../../../src/modules/tenman/services/guild-settings-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

function createMockPrisma(profileExists = true): PrismaClient {
  return {
    gameProfile: {
      findUnique: vi.fn().mockResolvedValue(
        profileExists
          ? {
              key: 'competitive_5v5',
              enabled: true,
              playersPerTeam: 5,
              numMaps: 1,
              serverSlots: 11,
              mapAllowlist: ['de_mirage', 'de_inferno'],
              matchzyOptions: {
                minPlayersToReady: 10,
                knifeRound: true,
                mapSide: 'knife',
              },
              allowedCvars: {},
            }
          : null,
      ),
    },
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn(async (callback) =>
      callback({
        $executeRaw: vi.fn().mockResolvedValue(undefined),
        guildSettings: { upsert: vi.fn().mockResolvedValue(undefined) },
        tenManSettings: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue(undefined),
        },
        auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      }),
    ),
  } as unknown as PrismaClient;
}

function createMockClient(allPermissions = true) {
  const channel = (type: ChannelType, id: string) => ({
    id,
    type,
    name: `channel-${id}`,
  });

  const permissions = {
    has: () => allPermissions,
  };

  const guild = {
    id: 'guild-1',
    channels: {
      fetch: async (id: string) => {
        if (id === 'text') return channel(ChannelType.GuildText, id);
        if (id === 'voice1' || id === 'voice2' || id === 'lobby')
          return channel(ChannelType.GuildVoice, id);
        return null;
      },
    },
    roles: {
      fetch: async () => ({ id: 'role-1', name: 'role' }),
    },
    members: {
      me: { permissionsIn: () => permissions },
      fetch: async () => ({ permissionsIn: () => permissions }),
    },
  };

  return {
    user: { id: 'bot-1' },
    guilds: {
      fetch: async () => guild,
    },
  };
}

const baseCommand = {
  guildId: 'guild-1',
  actorDiscordUserId: 'user-1',
  correlationId: 'corr-1',
  lobbyTextChannelId: 'text',
  lobbyVoiceChannelId: 'lobby',
  team1VoiceChannelId: 'voice1',
  team2VoiceChannelId: 'voice2',
  privilegedRoleIds: ['role-1'],
  moderatorRoleIds: ['role-2'],
  administratorRoleIds: ['role-3'],
  dathostTemplateServerId: 'template-1',
};

describe('GuildSettingsService', () => {
  it('saves valid configuration', async () => {
    const prisma = createMockPrisma();
    const client = createMockClient();
    const service = new GuildSettingsService(
      prisma,
      client as unknown as ConstructorParameters<typeof GuildSettingsService>[1],
    );

    await service.update(baseCommand);

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('throws when a channel is missing', async () => {
    const prisma = createMockPrisma();
    const client = createMockClient();
    client.guilds.fetch = async () => ({
      ...createMockGuild(),
      channels: {
        fetch: async () => null,
      },
    });
    const service = new GuildSettingsService(
      prisma,
      client as unknown as ConstructorParameters<typeof GuildSettingsService>[1],
    );

    await expect(service.update(baseCommand)).rejects.toThrow('Lobby text channel not found');
  });

  it('throws when bot lacks required permissions', async () => {
    const prisma = createMockPrisma();
    const client = createMockClient(false);
    const service = new GuildSettingsService(
      prisma,
      client as unknown as ConstructorParameters<typeof GuildSettingsService>[1],
    );

    await expect(service.update(baseCommand)).rejects.toThrow(
      'Bot is missing required permissions in lobby text channel',
    );
  });

  it('throws when the default game profile does not exist', async () => {
    const prisma = createMockPrisma(false);
    const client = createMockClient();
    const service = new GuildSettingsService(
      prisma,
      client as unknown as ConstructorParameters<typeof GuildSettingsService>[1],
    );

    await expect(
      service.update({ ...baseCommand, defaultGameProfileKey: 'missing' }),
    ).rejects.toThrow('Game profile missing does not exist');
  });

  it('rejects a queue size incompatible with the game profile', async () => {
    const prisma = createMockPrisma();
    const client = createMockClient();
    const service = new GuildSettingsService(
      prisma,
      client as unknown as ConstructorParameters<typeof GuildSettingsService>[1],
    );

    await expect(service.update({ ...baseCommand, queueSize: 8 })).rejects.toThrow(
      'Queue size must be 10',
    );
  });

  it('rejects a non-5v5 profile', async () => {
    const prisma = createMockPrisma();
    prisma.gameProfile.findUnique = vi.fn().mockResolvedValue({
      key: 'duo',
      enabled: true,
      playersPerTeam: 2,
      numMaps: 1,
      serverSlots: 5,
      mapAllowlist: ['de_mirage', 'de_inferno'],
      matchzyOptions: { minPlayersToReady: 4, knifeRound: true, mapSide: 'knife' },
      allowedCvars: {},
    });
    const service = new GuildSettingsService(
      prisma,
      createMockClient() as unknown as ConstructorParameters<typeof GuildSettingsService>[1],
    );

    await expect(service.update({ ...baseCommand })).rejects.toThrow(
      'selected game profile is not supported',
    );
  });
});

function createMockGuild() {
  return {
    id: 'guild-1',
    channels: {
      fetch: async () => null,
    },
    roles: {
      fetch: async () => ({ id: 'role-1', name: 'role' }),
    },
    members: {
      me: { permissionsIn: () => ({ has: () => true }) },
      fetch: async () => ({ permissionsIn: () => ({ has: () => true }) }),
    },
  };
}
