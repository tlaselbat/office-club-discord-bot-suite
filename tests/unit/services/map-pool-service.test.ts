import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import {
  canonicalOfficialMapName,
  canonicalWorkshopMapName,
  MapPoolService,
  paginateMapPool,
} from '../../../src/modules/tenman/services/map-pool-service.js';

const profile = { mapAllowlist: ['de_mirage', 'de_inferno', 'de_nuke'] };

function fakePrisma(options?: {
  version?: number;
  activeMapPool?: string[];
  existingCatalogMap?: boolean;
  deletedCount?: number;
  catalogMaps?: string[];
}) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        version: options?.version ?? 3,
        defaultGameProfileKey: 'competitive_5v5',
        activeMapPool: options?.activeMapPool ?? [],
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    gameProfile: { findUnique: vi.fn().mockResolvedValue(profile) },
    guildWorkshopMap: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options?.existingCatalogMap ? { mapName: 'workshop/123/de_example' } : null,
        ),
      findMany: vi
        .fn()
        .mockResolvedValue((options?.catalogMaps ?? []).map((mapName) => ({ mapName }))),
      create: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: options?.deletedCount ?? 1 }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  return {
    ...transaction,
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    transaction,
  } as unknown as PrismaClient & { transaction: typeof transaction };
}

describe('MapPoolService', () => {
  it('uses the profile allowlist until a guild saves an active pool', async () => {
    const prisma = fakePrisma();
    const service = new MapPoolService(prisma);

    await expect(service.getActiveMapPool('guild-1')).resolves.toEqual({
      mapNames: profile.mapAllowlist,
      source: 'PROFILE_DEFAULT',
    });
  });

  it('returns a saved guild pool rather than changing profile defaults', async () => {
    const service = new MapPoolService(fakePrisma({ activeMapPool: ['de_nuke', 'de_mirage'] }));
    await expect(service.getActiveMapPool('guild-1')).resolves.toEqual({
      mapNames: ['de_nuke', 'de_mirage'],
      source: 'GUILD_POOL',
    });
  });

  it('rejects a stale saved Workshop pool entry that is no longer catalogued', async () => {
    const service = new MapPoolService(
      fakePrisma({ activeMapPool: ['de_mirage', 'workshop/123/de_example'] }),
    );
    await expect(service.getActiveMapPool('guild-1')).rejects.toThrow('unavailable');
  });

  it('adds canonical workshop catalog entries and rejects duplicates', async () => {
    const prisma = fakePrisma();
    const service = new MapPoolService(prisma);
    await service.addWorkshopMap({
      guildId: 'guild-1',
      mapName: 'workshop/123/de_example',
      displayName: 'Example Workshop Map',
      actorDiscordUserId: 'admin-1',
      correlationId: 'corr-1',
    });
    expect(prisma.transaction.guildWorkshopMap.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mapName: 'workshop/123/de_example' }),
    });

    const duplicate = new MapPoolService(fakePrisma({ existingCatalogMap: true }));
    await expect(
      duplicate.addWorkshopMap({
        guildId: 'guild-1',
        mapName: 'workshop/123/de_example',
        actorDiscordUserId: 'admin-1',
        correlationId: 'corr-2',
      }),
    ).rejects.toThrow('already in this guild catalog');
  });

  it('rejects malformed and noncanonical map identifiers', () => {
    expect(canonicalOfficialMapName('de_mirage')).toBe('de_mirage');
    expect(canonicalWorkshopMapName('workshop/123/de_example')).toBe('workshop/123/de_example');
    expect(() => canonicalWorkshopMapName('workshop/not-an-id/de_example')).toThrow(
      'Workshop maps',
    );
    expect(() => canonicalWorkshopMapName('workshop/123/example')).toThrow('Workshop maps');
    expect(() => canonicalWorkshopMapName(`workshop/123/de_${'a'.repeat(90)}`)).toThrow(
      'Workshop maps',
    );
    expect(() => canonicalOfficialMapName('DE_MIRAGE')).toThrow('Official maps');
  });

  it('saves a mixed official and catalogued workshop pool using optimistic versioning', async () => {
    const prisma = fakePrisma({ catalogMaps: ['workshop/123/de_example'] });
    const service = new MapPoolService(prisma);
    await service.saveActiveMapPool({
      guildId: 'guild-1',
      mapNames: ['de_mirage', 'workshop/123/de_example'],
      expectedVersion: 3,
      actorDiscordUserId: 'admin-1',
      correlationId: 'corr-1',
    });
    expect(prisma.transaction.tenManSettings.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-1' },
      data: {
        activeMapPool: ['de_mirage', 'workshop/123/de_example'],
        version: { increment: 1 },
      },
    });
  });

  it('rejects duplicate, unavailable, and stale-pool writes', async () => {
    const service = new MapPoolService(fakePrisma());
    await expect(
      service.saveActiveMapPool({
        guildId: 'guild-1',
        mapNames: ['de_mirage', 'de_mirage'],
        expectedVersion: 3,
        actorDiscordUserId: 'admin-1',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrow('duplicate');
    await expect(
      service.saveActiveMapPool({
        guildId: 'guild-1',
        mapNames: ['de_mirage', 'workshop/123/de_example'],
        expectedVersion: 3,
        actorDiscordUserId: 'admin-1',
        correlationId: 'corr-2',
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      new MapPoolService(fakePrisma({ version: 4 })).saveActiveMapPool({
        guildId: 'guild-1',
        mapNames: ['de_mirage', 'de_inferno'],
        expectedVersion: 3,
        actorDiscordUserId: 'admin-1',
        correlationId: 'corr-3',
      }),
    ).rejects.toThrow('Configuration changed');
  });

  it('removes a workshop entry from the active pool without touching match snapshots', async () => {
    const prisma = fakePrisma({ activeMapPool: ['de_mirage', 'workshop/123/de_example'] });
    await new MapPoolService(prisma).removeWorkshopMap({
      guildId: 'guild-1',
      mapName: 'workshop/123/de_example',
      actorDiscordUserId: 'admin-1',
      correlationId: 'corr-1',
    });
    expect(prisma.transaction.tenManSettings.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-1' },
      data: { activeMapPool: ['de_mirage'], version: { increment: 1 } },
    });
    expect(
      (prisma as unknown as { transaction: Record<string, unknown> }).transaction,
    ).not.toHaveProperty('match');
  });
});

describe('paginateMapPool', () => {
  it('keeps Discord select pages at 25 entries and rejects stale pages', () => {
    const maps = Array.from({ length: 26 }, (_, index) => `de_map_${String(index)}`);
    expect(paginateMapPool(maps, 0)).toMatchObject({ pageCount: 2, hasNextPage: true });
    expect(paginateMapPool(maps, 1)).toMatchObject({ items: ['de_map_25'], hasPreviousPage: true });
    expect(() => paginateMapPool(maps, 2)).toThrow('outside');
  });
});
