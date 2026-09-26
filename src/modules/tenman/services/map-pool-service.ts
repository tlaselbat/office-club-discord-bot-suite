import type { PrismaClient } from '../../../generated/prisma/client.js';

const officialMapPattern = /^de_[a-z0-9_]+$/;
const workshopMapPattern = /^workshop\/[1-9][0-9]*\/de_[a-z0-9_]+$/;
const maxSelectOptions = 25;

export interface AddWorkshopMapCommand {
  guildId: string;
  mapName: string;
  displayName?: string;
  actorDiscordUserId: string;
  correlationId: string;
}

export interface RemoveWorkshopMapCommand {
  guildId: string;
  mapName: string;
  actorDiscordUserId: string;
  correlationId: string;
}

export interface SaveActiveMapPoolCommand {
  guildId: string;
  mapNames: string[];
  expectedVersion: number;
  actorDiscordUserId: string;
  correlationId: string;
}

export interface MapPoolPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface ActiveMapPool {
  mapNames: string[];
  source: 'GUILD_POOL' | 'PROFILE_DEFAULT';
}

export function canonicalOfficialMapName(mapName: string): string {
  const canonical = mapName.trim().toLowerCase();
  if (mapName !== canonical || !officialMapPattern.test(canonical)) {
    throw new Error('Official maps must use canonical de_* identifiers');
  }
  return canonical;
}

export function canonicalWorkshopMapName(mapName: string): string {
  const canonical = mapName.trim().toLowerCase();
  if (mapName !== canonical || !workshopMapPattern.test(canonical)) {
    throw new Error('Workshop maps must use workshop/<numeric-id>/de_<map-name> identifiers');
  }
  return canonical;
}

/**
 * Owns the mutable guild map catalog and active pool. Match creation must copy
 * getActiveMapPool() into its immutable match snapshot; this service never
 * modifies historical matches.
 */
export class MapPoolService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listWorkshopCatalog(guildId: string) {
    return this.prisma.guildWorkshopMap.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
      select: { mapName: true, displayName: true, addedByDiscordUserId: true, createdAt: true },
    });
  }

  public async getActiveMapPool(guildId: string): Promise<ActiveMapPool> {
    const settings = await this.prisma.tenManSettings.findUnique({
      where: { guildId },
      select: { activeMapPool: true, defaultGameProfileKey: true },
    });
    if (settings === null) throw new Error('Competitive configuration is missing');
    const profile = await this.getProfile(settings.defaultGameProfileKey);
    if (settings.activeMapPool.length > 0) {
      await this.assertPoolIsAvailable(guildId, settings.activeMapPool, profile);
      return { mapNames: settings.activeMapPool, source: 'GUILD_POOL' };
    }
    return { mapNames: profile.mapAllowlist, source: 'PROFILE_DEFAULT' };
  }

  public async addWorkshopMap(command: AddWorkshopMapCommand): Promise<void> {
    const mapName = canonicalWorkshopMapName(command.mapName);
    const displayName = this.displayName(command.displayName, mapName);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const settings = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
        select: { guildId: true },
      });
      if (settings === null) throw new Error('Competitive configuration is missing');
      const existing = await transaction.guildWorkshopMap.findUnique({
        where: { guildId_mapName: { guildId: command.guildId, mapName } },
        select: { mapName: true },
      });
      if (existing !== null) throw new Error('Workshop map is already in this guild catalog');

      await transaction.guildWorkshopMap.create({
        data: {
          guildId: command.guildId,
          mapName,
          displayName,
          addedByDiscordUserId: command.actorDiscordUserId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'workshop_map_added',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { mapName, displayName },
        },
      });
    });
  }

  public async removeWorkshopMap(command: RemoveWorkshopMapCommand): Promise<void> {
    const mapName = canonicalWorkshopMapName(command.mapName);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const settings = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
        select: { activeMapPool: true },
      });
      if (settings === null) throw new Error('Competitive configuration is missing');
      const deleted = await transaction.guildWorkshopMap.deleteMany({
        where: { guildId: command.guildId, mapName },
      });
      if (deleted.count === 0) throw new Error('Workshop map is not in this guild catalog');

      const nextPool = settings.activeMapPool.filter((candidate) => candidate !== mapName);
      const removedFromPool = nextPool.length !== settings.activeMapPool.length;
      if (removedFromPool) {
        await transaction.tenManSettings.update({
          where: { guildId: command.guildId },
          data: { activeMapPool: nextPool, version: { increment: 1 } },
        });
      }
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'workshop_map_removed',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { mapName, removedFromPool },
        },
      });
    });
  }

  public async saveActiveMapPool(command: SaveActiveMapPoolCommand): Promise<void> {
    const mapNames = this.validateDistinctMapNames(command.mapNames);
    if (mapNames.length < 2)
      throw new Error('The competitive map pool must contain at least two maps');

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const settings = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
        select: { version: true, defaultGameProfileKey: true },
      });
      if (settings === null) throw new Error('Competitive configuration is missing');
      if (settings.version !== command.expectedVersion)
        throw new Error('Configuration changed; reload and try again');

      const profile = await this.getProfile(settings.defaultGameProfileKey, transaction);
      await this.assertPoolIsAvailable(command.guildId, mapNames, profile, transaction);

      await transaction.tenManSettings.update({
        where: { guildId: command.guildId },
        data: { activeMapPool: mapNames, version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'active_map_pool_updated',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { mapNames },
        },
      });
    });
  }

  private async getProfile(
    profileKey: string | null,
    client: Pick<PrismaClient, 'gameProfile'> = this.prisma,
  ) {
    const profile = await client.gameProfile.findUnique({
      where: { key: profileKey ?? 'competitive_5v5' },
      select: { mapAllowlist: true },
    });
    if (profile === null) throw new Error('Configured game profile is missing');
    return profile;
  }

  private validateDistinctMapNames(mapNames: string[]): string[] {
    const seen = new Set<string>();
    for (const mapName of mapNames) {
      const canonical = officialMapPattern.test(mapName.trim().toLowerCase())
        ? canonicalOfficialMapName(mapName)
        : canonicalWorkshopMapName(mapName);
      if (seen.has(canonical)) throw new Error('The active map pool cannot contain duplicate maps');
      seen.add(canonical);
    }
    return [...seen];
  }

  private async assertPoolIsAvailable(
    guildId: string,
    mapNames: readonly string[],
    profile: { mapAllowlist: string[] },
    client: Pick<PrismaClient, 'guildWorkshopMap'> = this.prisma,
  ): Promise<void> {
    const officialMaps = new Set(
      profile.mapAllowlist.filter((mapName) => officialMapPattern.test(mapName)),
    );
    const requestedWorkshopMaps = mapNames.filter((mapName) => workshopMapPattern.test(mapName));
    const catalogMaps = new Set(
      (
        await client.guildWorkshopMap.findMany({
          where: { guildId, mapName: { in: requestedWorkshopMaps } },
          select: { mapName: true },
        })
      ).map((entry) => entry.mapName),
    );
    for (const mapName of mapNames) {
      if (officialMapPattern.test(mapName) && officialMaps.has(mapName)) continue;
      if (workshopMapPattern.test(mapName) && catalogMaps.has(mapName)) continue;
      throw new Error(`Map ${mapName} is unavailable for this guild`);
    }
  }

  private displayName(displayName: string | undefined, fallback: string): string {
    const normalized = displayName?.trim().replace(/\s+/g, ' ') ?? fallback;
    if (normalized.length === 0 || normalized.length > 100)
      throw new Error('Workshop map display name must be between 1 and 100 characters');
    return normalized;
  }
}

export function paginateMapPool<T>(
  items: readonly T[],
  page: number,
  pageSize = maxSelectOptions,
): MapPoolPage<T> {
  if (!Number.isInteger(page) || page < 0) throw new Error('Page must be a non-negative integer');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxSelectOptions)
    throw new Error('Page size must be between 1 and 25');
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  if (page >= pageCount) throw new Error('Page is outside the available map catalog');
  return {
    items: [...items.slice(page * pageSize, (page + 1) * pageSize)],
    page,
    pageCount,
    hasPreviousPage: page > 0,
    hasNextPage: page + 1 < pageCount,
  };
}
