import type { PrismaClient } from '../../generated/prisma/client.js';
import { scheduleJob } from '../../database/schedule-job.js';
import type { DatHostGameServerProvider, GameServerObservation } from './provider.js';

const pollIntervalMs = 30_000;

export class GameServerPollService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: DatHostGameServerProvider,
  ) {}

  public async poll(
    gameServerId: string,
    now = new Date(),
  ): Promise<{ rescheduleAt: Date } | undefined> {
    const registration = await this.prisma.gameServer.findUnique({
      where: { id: gameServerId },
      include: { snapshot: true },
    });
    if (registration === null || !registration.enabled) return undefined;
    const previous = registration.snapshot;
    try {
      const current = await this.provider.observe(
        registration.providerServerId,
        previous === null ? undefined : { players: previous.players },
        now,
      );
      const observation =
        previous === null || current.monitoringSource || current.hostingState !== 'RUNNING'
          ? current
          : {
              ...current,
              cpuPercent: previous.cpuPercent,
              memoryUsageMb: previous.memoryUsageMb,
              averagePingMs: previous.averagePingMs,
              packetLossPercent: previous.packetLossPercent,
              serverVarMs: previous.serverVarMs,
              connectedSteamIds: previous.connectedSteamIds,
              monitoringObservedAt: previous.monitoringObservedAt,
            };
      const telemetryReference = previous?.monitoringObservedAt ?? previous?.serverObservedAt;
      const telemetryStale =
        observation.hostingState === 'RUNNING' &&
        !observation.monitoringSource &&
        telemetryReference !== null &&
        telemetryReference !== undefined &&
        now.getTime() - telemetryReference.getTime() >= 90_000;
      const changed =
        previous === null ||
        displayFingerprint(previous) !==
          displayFingerprint({ ...observation, stale: telemetryStale });
      await this.prisma.$transaction(async (transaction) => {
        await transaction.gameServerSnapshot.upsert({
          where: { gameServerId },
          create: {
            gameServerId,
            ...snapshotData(observation),
            lastSuccessfulAt: now,
            lastOnlineAt: observation.hostingState === 'RUNNING' ? now : null,
          },
          update: {
            ...snapshotData(observation),
            lastSuccessfulAt: now,
            ...(observation.hostingState === 'RUNNING' ? { lastOnlineAt: now } : {}),
            consecutiveFailures: 0,
            stale: telemetryStale,
            lastError: null,
          },
        });
        if (changed) await schedulePanelRefresh(transaction, registration.guildId);
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown DatHost error';
      const failures = (previous?.consecutiveFailures ?? 0) + 1;
      await this.prisma.$transaction(async (transaction) => {
        await transaction.gameServerSnapshot.upsert({
          where: { gameServerId },
          create: {
            gameServerId,
            hostingState: 'UNKNOWN',
            gameplayState: 'UNKNOWN',
            observedAt: now,
            consecutiveFailures: failures,
            stale: failures >= 2,
            lastError: message.slice(0, 1000),
          },
          update: {
            ...(failures >= 3 ? { hostingState: 'UNKNOWN' as const } : {}),
            gameplayState: previous?.hostingState === 'RUNNING' ? 'DEGRADED' : 'UNKNOWN',
            observedAt: now,
            consecutiveFailures: failures,
            stale: failures >= 2,
            lastError: message.slice(0, 1000),
          },
        });
        await schedulePanelRefresh(transaction, registration.guildId);
      });
    }
    return { rescheduleAt: new Date(now.getTime() + pollIntervalMs) };
  }
}

export async function scheduleGameServerPoll(
  prisma: PrismaClient,
  gameServerId: string,
  runAt = new Date(),
): Promise<void> {
  await scheduleJob(prisma, {
    type: 'GAME_SERVER_DATHOST_POLL',
    idempotencyKey: `game-server:dathost:${gameServerId}`,
    payload: { gameServerId },
    runAt,
  });
}

export async function schedulePanelRefresh(
  prisma: Pick<PrismaClient, 'job'>,
  guildId: string,
): Promise<void> {
  await scheduleJob(prisma, {
    type: 'GAME_SERVER_PANEL_REFRESH',
    idempotencyKey: `game-server:panel:${guildId}`,
    payload: { guildId },
  });
}

function snapshotData(observation: GameServerObservation) {
  return {
    hostingState: observation.hostingState,
    gameplayState: observation.gameplayState,
    host: observation.host,
    rawIp: observation.rawIp,
    port: observation.port,
    datacenter: observation.datacenter,
    hostname: observation.hostname,
    map: observation.map,
    players: observation.players,
    maxPlayers: observation.maxPlayers,
    playerCountSource: observation.playerCountSource,
    cpuPercent: observation.cpuPercent,
    memoryUsageMb: observation.memoryUsageMb,
    averagePingMs: observation.averagePingMs,
    packetLossPercent: observation.packetLossPercent,
    serverVarMs: observation.serverVarMs,
    connectedSteamIds: observation.connectedSteamIds,
    serverSource: observation.serverSource,
    monitoringSource: observation.monitoringSource,
    consoleSource: false,
    serverObservedAt: observation.serverObservedAt,
    monitoringObservedAt: observation.monitoringObservedAt,
    observedAt: observation.observedAt,
  };
}

function displayFingerprint(value: object): string {
  const fields = value as Record<string, unknown>;
  return JSON.stringify({
    hostingState: fields.hostingState,
    gameplayState: fields.gameplayState,
    host: fields.host,
    port: fields.port,
    datacenter: fields.datacenter,
    map: fields.map,
    players: fields.players,
    maxPlayers: fields.maxPlayers,
    cpuPercent: fields.cpuPercent,
    memoryUsageMb: fields.memoryUsageMb,
    averagePingMs: fields.averagePingMs,
    packetLossPercent: fields.packetLossPercent,
    serverVarMs: fields.serverVarMs,
    stale: fields.stale,
  });
}
