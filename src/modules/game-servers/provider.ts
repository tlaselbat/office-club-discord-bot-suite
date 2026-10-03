import type { DatHostServerReader } from '../../integrations/dathost/client.js';
import type { DatHostCsMonitoringMetrics } from '../../integrations/dathost/schemas.js';
import { queryA2sCurrentMap, type A2sInfoQuery } from '../../integrations/source/a2s-info.js';
import { isIP } from 'node:net';

export interface GameServerObservation {
  hostingState: 'STOPPED' | 'STARTING' | 'RUNNING' | 'UNKNOWN';
  gameplayState: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
  host: string | null;
  rawIp: string | null;
  port: number | null;
  datacenter: string | null;
  hostname: string | null;
  map: string | null;
  players: number | null;
  maxPlayers: number | null;
  playerCountSource: 'DATHOST_MONITORING' | 'DATHOST_SERVER_OBJECT' | 'CACHE' | null;
  cpuPercent: number | null;
  memoryUsageMb: number | null;
  averagePingMs: number | null;
  packetLossPercent: number | null;
  serverVarMs: number | null;
  connectedSteamIds: string[];
  serverSource: boolean;
  monitoringSource: boolean;
  serverObservedAt: Date | null;
  monitoringObservedAt: Date | null;
  observedAt: Date;
}

export interface PreviousPlayerCount {
  players: number | null;
}

export class DatHostGameServerProvider {
  public constructor(
    private readonly reader: DatHostServerReader,
    private readonly queryCurrentMap: A2sInfoQuery = queryA2sCurrentMap,
  ) {}

  public async observe(
    providerServerId: string,
    previous?: PreviousPlayerCount,
    now = new Date(),
  ): Promise<GameServerObservation> {
    const server = await this.reader.getServer(providerServerId);
    if (server === null) throw new Error('DatHost server is unavailable or inaccessible');
    const hostingState = server.on === false ? 'STOPPED' : server.booting ? 'STARTING' : 'RUNNING';
    const base: GameServerObservation = {
      hostingState,
      gameplayState:
        hostingState === 'STOPPED'
          ? 'UNAVAILABLE'
          : hostingState === 'STARTING'
            ? 'UNKNOWN'
            : 'DEGRADED',
      host: server.custom_domain ?? server.ip ?? null,
      rawIp: server.raw_ip ?? server.ip ?? null,
      port: server.ports?.game ?? null,
      datacenter: server.location ?? null,
      hostname: server.name || null,
      // DatHost settings describe configuration, not the running server's map.
      map: null,
      players: server.players_online ?? (previous?.players === undefined ? null : previous.players),
      maxPlayers:
        server.cs2_settings?.slots ??
        server.cs2_settings?.max_players ??
        server.csgo_settings?.slots ??
        server.csgo_settings?.max_players ??
        null,
      playerCountSource:
        server.players_online !== undefined
          ? 'DATHOST_SERVER_OBJECT'
          : previous?.players != null
            ? 'CACHE'
            : null,
      cpuPercent: null,
      memoryUsageMb: null,
      averagePingMs: null,
      packetLossPercent: null,
      serverVarMs: null,
      connectedSteamIds: [],
      serverSource: true,
      monitoringSource: false,
      serverObservedAt: now,
      monitoringObservedAt: null,
      observedAt: now,
    };
    if (hostingState !== 'RUNNING') return base;
    const observed = await this.observeCurrentMap(base);
    try {
      const metrics = await this.reader.getCsMonitoringMetrics(
        providerServerId,
        new Date(now.getTime() - 2 * 60_000),
        now,
      );
      return mergeMetrics(observed, metrics, now);
    } catch {
      return observed;
    }
  }

  private async observeCurrentMap(
    observation: GameServerObservation,
  ): Promise<GameServerObservation> {
    if (
      observation.rawIp === null ||
      isIP(observation.rawIp) !== 4 ||
      observation.port === null ||
      !Number.isInteger(observation.port) ||
      observation.port < 1 ||
      observation.port > 65_535
    ) {
      return observation;
    }
    try {
      return {
        ...observation,
        map: await this.queryCurrentMap(observation.rawIp, observation.port),
      };
    } catch {
      // A failed live query must remain unknown; settings, start-map, history,
      // and cached values do not prove the current map.
      return observation;
    }
  }
}

function mergeMetrics(
  observation: GameServerObservation,
  metrics: DatHostCsMonitoringMetrics,
  now: Date,
): GameServerObservation {
  const connectedSteamIds = [
    ...new Set(metrics.player_ids?.players.map((player) => player.steamid64) ?? []),
  ];
  const monitoringPlayers = metrics.player_ids === undefined ? null : connectedSteamIds.length;
  return {
    ...observation,
    gameplayState: 'AVAILABLE',
    players: monitoringPlayers ?? observation.players,
    playerCountSource:
      monitoringPlayers === null ? observation.playerCountSource : 'DATHOST_MONITORING',
    cpuPercent: newest(metrics.cpu_memory?.cpu),
    memoryUsageMb: newest(metrics.cpu_memory?.memory_mb),
    averagePingMs: newestAverage(metrics.player_ping?.series),
    packetLossPercent: newestAverage(metrics.player_loss?.series),
    serverVarMs: newest(metrics.svms?.values),
    connectedSteamIds,
    monitoringSource: true,
    monitoringObservedAt: newestTimestamp(metrics) ?? now,
  };
}

function newest(points: [string, number | null][] | undefined): number | null {
  if (points === undefined) return null;
  return (
    [...points]
      .sort((left, right) => Date.parse(right[0]) - Date.parse(left[0]))
      .find((point) => point[1] !== null)?.[1] ?? null
  );
}

function newestAverage(series: { values: [string, number | null][] }[] | undefined): number | null {
  const values = series?.map((item) => newest(item.values)).filter((value) => value !== null) ?? [];
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function newestTimestamp(metrics: DatHostCsMonitoringMetrics): Date | null {
  const timestamps = [
    ...(metrics.cpu_memory?.cpu ?? []),
    ...(metrics.cpu_memory?.memory_mb ?? []),
    ...(metrics.svms?.values ?? []),
    ...(metrics.player_ping?.series.flatMap((series) => series.values) ?? []),
    ...(metrics.player_loss?.series.flatMap((series) => series.values) ?? []),
  ].map((point) => Date.parse(point[0]));
  const newestValue = timestamps.length === 0 ? Number.NaN : Math.max(...timestamps);
  return Number.isFinite(newestValue) ? new Date(newestValue) : null;
}
