import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { GuildSettingsService } from '../../../src/modules/tenman/services/guild-settings-service.js';

const profile = {
  key: 'competitive_5v5',
  enabled: true,
  playersPerTeam: 5,
  numMaps: 1,
  serverSlots: 11,
  mapAllowlist: ['de_mirage', 'workshop/12345/de_example'],
  matchzyOptions: { minPlayersToReady: 10, knifeRound: true, mapSide: 'knife' },
  allowedCvars: {},
};

function createPrisma(settings: { version: number; managedResourceState: string }) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({
        ...settings,
        defaultGameProfileKey: 'competitive_5v5',
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    gameProfile: { findUnique: vi.fn().mockResolvedValue(profile) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  return {
    $transaction: vi.fn(async (callback) => callback(transaction)),
    transaction,
  } as unknown as PrismaClient & { transaction: typeof transaction };
}

describe('GuildSettingsService.updateQueueOptions', () => {
  it('updates only supported queue choices and records an audit event', async () => {
    const prisma = createPrisma({ version: 7, managedResourceState: 'ACTIVE' });
    const service = new GuildSettingsService(prisma, {} as ConstructorParameters<typeof GuildSettingsService>[1]);

    await service.updateQueueOptions({
      guildId: 'guild-1',
      actorDiscordUserId: 'admin-1',
      correlationId: 'corr-1',
      expectedVersion: 7,
      defaultServerLocation: 'virginia',
      teamSelectionMode: 'RANDOM',
      mapSelectionMode: 'RANDOM',
    });

    expect(prisma.transaction.tenManSettings.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-1' },
      data: {
        defaultServerLocation: 'virginia',
        teamSelectionMode: 'RANDOM',
        mapSelectionMode: 'RANDOM',
        version: { increment: 1 },
      },
    });
    expect(prisma.transaction.auditEvent.create).toHaveBeenCalledOnce();
  });

  it('rejects stale configuration and setup that is not active', async () => {
    const stale = createPrisma({ version: 8, managedResourceState: 'ACTIVE' });
    const inactive = createPrisma({ version: 7, managedResourceState: 'SETTING_UP' });
    const command = {
      guildId: 'guild-1',
      actorDiscordUserId: 'admin-1',
      correlationId: 'corr-1',
      expectedVersion: 7,
      defaultServerLocation: 'dallas' as const,
      teamSelectionMode: 'CAPTAINS' as const,
      mapSelectionMode: 'CAPTAIN_VETO' as const,
    };
    await expect(
      new GuildSettingsService(stale, {} as ConstructorParameters<typeof GuildSettingsService>[1]).updateQueueOptions(command),
    ).rejects.toThrow('Configuration changed');
    await expect(
      new GuildSettingsService(inactive, {} as ConstructorParameters<typeof GuildSettingsService>[1]).updateQueueOptions(command),
    ).rejects.toThrow('setup must be active');
  });
});
