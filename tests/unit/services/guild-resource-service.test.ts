import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { GuildResourceService } from '../../../src/modules/tenman/services/guild-resource-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

function createService(settings: object | null, activeMatch: object | null = null) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue(settings),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    match: { findFirst: vi.fn().mockResolvedValue(activeMatch) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const prisma = {
    tenManSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
    match: { findFirst: vi.fn().mockResolvedValue(activeMatch) },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  const service = new GuildResourceService(
    prisma,
    {} as ConstructorParameters<typeof GuildResourceService>[1],
    { error: vi.fn() } as unknown as ConstructorParameters<typeof GuildResourceService>[2],
  );
  return { service, transaction };
}

const managedSettings = {
  guildId: '123456789012345678',
  enabled: true,
  version: 3,
  managedResourceState: 'ACTIVE',
  managedSetupStep: null,
  managedAttemptId: '123e4567-e89b-12d3-a456-426614174000',
  managedCategoryId: '323456789012345678',
  managedChannelIds: ['423456789012345678'],
  managedResourcesCreatedAt: new Date(),
};

describe('GuildResourceService lifecycle guards', () => {
  it('makes the Admin channel private to staff roles and the bot', () => {
    const { service } = createService(null);
    (service as unknown as { client: object }).client = { user: { id: 'bot-user' } };
    const overwrites = (
      service as unknown as {
        adminChannelPermissionOverwrites: (
          guild: object,
          resolved: object,
        ) => Array<{ id: string; allow?: bigint[]; deny?: bigint[] }>;
      }
    ).adminChannelPermissionOverwrites(
      { roles: { everyone: { id: 'everyone' } }, members: { me: null } },
      { moderatorRoleIds: ['moderator'], administratorRoleIds: ['administrator'] },
    );

    expect(overwrites).toEqual([
      {
        id: 'everyone',
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      expect.objectContaining({
        id: 'moderator',
        allow: expect.arrayContaining([PermissionFlagsBits.ViewChannel]),
      }),
      expect.objectContaining({
        id: 'administrator',
        allow: expect.arrayContaining([PermissionFlagsBits.ViewChannel]),
      }),
      expect.objectContaining({
        id: 'bot-user',
        allow: expect.arrayContaining([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ]),
      }),
    ]);
  });

  it('soft-disables without clearing managed resources', async () => {
    const { service, transaction } = createService(managedSettings);
    await expect(
      service.disable('123456789012345678', '223456789012345678', 'correlation'),
    ).resolves.toBe(true);
    expect(transaction.tenManSettings.update).toHaveBeenCalledWith({
      where: { guildId: '123456789012345678' },
      data: { enabled: false, version: { increment: 1 } },
    });
  });

  it('refuses teardown preview while a guild slot is active', async () => {
    const { service } = createService(managedSettings, { id: 'match' });
    await expect(service.teardownPreview('123456789012345678')).rejects.toThrow(
      'Finish the active match',
    );
  });

  it('refuses to archive manual resources', async () => {
    const { service } = createService({
      ...managedSettings,
      managedResourceState: 'NONE',
      managedCategoryId: null,
      managedChannelIds: [],
    });
    await expect(service.teardownPreview('123456789012345678')).rejects.toThrow(
      'Manually configured channels are never changed',
    );
  });

  it('archives and locks tracked resources without deleting them', async () => {
    const { service } = createService(managedSettings);
    const edit = vi.fn().mockResolvedValue(undefined);
    const permissionEdit = vi.fn().mockResolvedValue(undefined);
    const deleteChannel = vi.fn().mockResolvedValue(undefined);
    const channel = {
      name: 'match-queue',
      edit,
      delete: deleteChannel,
      permissionOverwrites: { edit: permissionEdit },
    };
    const guild = {
      roles: { everyone: { id: 'everyone' } },
      members: { me: { permissions: { has: vi.fn().mockReturnValue(true) } } },
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
    };
    (service as unknown as { client: object }).client = {
      guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    };

    await (
      service as unknown as {
        archiveTracked: (guildId: string, actorId: string, correlationId: string) => Promise<void>;
      }
    ).archiveTracked('123456789012345678', '223456789012345678', 'correlation');

    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'archived-competitive-match-queue' }),
    );
    expect(permissionEdit).toHaveBeenCalledWith(
      { id: 'everyone' },
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
    );
    expect(deleteChannel).not.toHaveBeenCalled();
  });
});
