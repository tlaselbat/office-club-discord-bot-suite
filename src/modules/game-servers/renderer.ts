import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { createGameServerCustomId } from './custom-id.js';

export interface SnapshotView {
  hostingState: string;
  gameplayState: string;
  host: string | null;
  hostname: string | null;
  port: number | null;
  datacenter: string | null;
  map: string | null;
  players: number | null;
  maxPlayers: number | null;
  cpuPercent: number | null;
  memoryUsageMb: number | null;
  averagePingMs: number | null;
  packetLossPercent: number | null;
  serverVarMs: number | null;
  observedAt: Date;
  monitoringObservedAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastOnlineAt: Date | null;
  stale: boolean;
}

export interface ServerView {
  id: string;
  displayName: string;
  description: string | null;
  connectDomain: string | null;
  joinUrl: string | null;
  enabled: boolean;
  public: boolean;
  sortOrder: number;
  providerServerId: string;
  snapshot: SnapshotView | null;
}

export interface CardFingerprint {
  hostingState: string;
  gameplayState: string;
  stale: boolean;
  players: number | null;
  maxPlayers: number | null;
  map: string | null;
  host: string | null;
  datacenter: string | null;
  connectAddress: string | null;
  cpuPercent: number | null;
  memoryUsageMb: number | null;
}

export function renderAddGameServersPanel(
  servers: ServerView[],
  secret: string,
  selectedId?: string,
) {
  const embed = new EmbedBuilder()
    .setColor(0x2b8aef)
    .setTitle('OFFICE CLUB • ADD GAME SERVERS')
    .setDescription('Select a configured game server to add to the live server display.');
  const components: (
    | ActionRowBuilder<StringSelectMenuBuilder>
    | ActionRowBuilder<ButtonBuilder>
  )[] = [];
  if (servers.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(createGameServerCustomId({ action: 'select' }, secret))
          .setPlaceholder('Select Server')
          .addOptions(
            servers.slice(0, 25).map((server) => ({
              label: server.displayName.slice(0, 100),
              value: server.id,
              description: statusLabel(server.snapshot).slice(0, 100),
              default: server.id === selectedId,
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          createGameServerCustomId(
            selectedId === undefined ? { action: 'add' } : { action: 'add', value: selectedId },
            secret,
          ),
        )
        .setLabel('Add Server')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(selectedId === undefined),
    ),
  );
  return { embeds: [embed], components };
}

export function renderGameServerCard(server: ServerView) {
  const snapshot = server.snapshot;
  const embed = new EmbedBuilder().setColor(color(snapshot)).setTitle(server.displayName);
  if (server.description !== null) embed.setDescription(server.description);
  embed.addFields({ name: 'Status', value: statusLabel(snapshot), inline: true });
  if (snapshot?.players !== null && snapshot?.players !== undefined) {
    embed.addFields({
      name: 'Players',
      value: `${String(snapshot.players)}${snapshot.maxPlayers === null ? '' : ` / ${String(snapshot.maxPlayers)}`}`,
      inline: true,
    });
  }
  if (snapshot?.map !== null && snapshot?.map !== undefined)
    embed.addFields({ name: 'Map', value: snapshot.map, inline: true });
  embed.addFields({
    name: 'Host',
    value: serverHost(server),
    inline: true,
  });
  if (snapshot?.datacenter !== null && snapshot?.datacenter !== undefined)
    embed.addFields({ name: 'Location', value: snapshot.datacenter, inline: true });
  const address = connectAddress(server);
  if (address !== null) embed.addFields({ name: 'Connect', value: `\`${address}\``, inline: true });
  embed.addFields({ name: 'Provider', value: 'DatHost', inline: true });
  if (snapshot?.cpuPercent !== null && snapshot?.cpuPercent !== undefined)
    embed.addFields({ name: 'CPU', value: `${snapshot.cpuPercent.toFixed(1)}%`, inline: true });
  if (snapshot?.memoryUsageMb !== null && snapshot?.memoryUsageMb !== undefined)
    embed.addFields({
      name: 'Memory',
      value: `${snapshot.memoryUsageMb.toFixed(1)} MB`,
      inline: true,
    });
  if (snapshot !== null)
    embed.addFields({
      name: 'Updated',
      value: `<t:${String(Math.floor(snapshot.observedAt.getTime() / 1000))}:R>`,
      inline: true,
    });
  const components =
    server.joinUrl === null
      ? []
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel('Connect')
              .setStyle(ButtonStyle.Link)
              .setURL(server.joinUrl),
          ),
        ];
  return { embeds: [embed], components };
}

export function renderGameServerDetail(server: ServerView) {
  const snapshot = server.snapshot;
  const embed = new EmbedBuilder().setColor(color(snapshot)).setTitle(server.displayName);
  if (server.description !== null) embed.setDescription(server.description);
  embed.addFields({ name: 'Status', value: statusLabel(snapshot), inline: true });
  if (snapshot?.players !== null && snapshot?.players !== undefined) {
    embed.addFields({
      name: 'Players',
      value: `${String(snapshot.players)}${snapshot.maxPlayers === null ? '' : ` / ${String(snapshot.maxPlayers)}`}`,
      inline: true,
    });
  }
  if (snapshot?.map !== null && snapshot?.map !== undefined)
    embed.addFields({ name: 'Map', value: snapshot.map, inline: true });
  const network = [
    metric('Average ping', snapshot?.averagePingMs, 'ms'),
    metric('Packet loss', snapshot?.packetLossPercent, '%'),
    metric('Server var', snapshot?.serverVarMs, 'ms'),
  ].filter((line) => line !== null);
  if (network.length > 0)
    embed.addFields({ name: 'Network', value: network.join('\n'), inline: true });
  const hostMetrics = [
    metric('CPU', snapshot?.cpuPercent, '%'),
    metric('Memory', snapshot?.memoryUsageMb, 'MB'),
  ].filter((line) => line !== null);
  if (hostMetrics.length > 0)
    embed.addFields({ name: 'Host', value: hostMetrics.join('\n'), inline: true });
  if (snapshot?.datacenter !== null && snapshot?.datacenter !== undefined)
    embed.addFields({ name: 'Location', value: snapshot.datacenter, inline: true });
  const address = connectAddress(server);
  if (address !== null) embed.addFields({ name: 'Connect', value: `\`${address}\``, inline: true });
  embed.addFields({ name: 'Provider', value: 'DatHost', inline: true });
  if (snapshot !== null)
    embed.addFields({
      name: 'Updated',
      value: `<t:${String(Math.floor(snapshot.observedAt.getTime() / 1000))}:R>`,
      inline: true,
    });
  const components =
    server.joinUrl === null
      ? []
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel('Connect')
              .setStyle(ButtonStyle.Link)
              .setURL(server.joinUrl),
          ),
        ];
  return { embeds: [embed], components };
}

export function cardFingerprint(server: ServerView): CardFingerprint {
  const snapshot = server.snapshot;
  return {
    hostingState: snapshot?.hostingState ?? 'UNKNOWN',
    gameplayState: snapshot?.gameplayState ?? 'UNKNOWN',
    stale: snapshot?.stale ?? false,
    players: snapshot?.players ?? null,
    maxPlayers: snapshot?.maxPlayers ?? null,
    map: snapshot?.map ?? null,
    host: serverHost(server),
    datacenter: snapshot?.datacenter ?? null,
    connectAddress: connectAddress(server),
    cpuPercent: snapshot?.cpuPercent ?? null,
    memoryUsageMb: snapshot?.memoryUsageMb ?? null,
  };
}

function serverHost(server: ServerView): string {
  const snapshot = server.snapshot;
  return snapshot?.hostname ?? snapshot?.host ?? server.connectDomain ?? 'Unknown';
}

function statusLabel(snapshot: SnapshotView | null): string {
  if (snapshot === null) return 'Status pending';
  if (snapshot.hostingState === 'STOPPED') return 'Server stopped';
  if (snapshot.hostingState === 'STARTING') return 'Server starting…';
  if (snapshot.stale) return 'Status stale';
  if (snapshot.hostingState === 'RUNNING' && snapshot.gameplayState === 'AVAILABLE')
    return 'Online';
  if (snapshot.hostingState === 'RUNNING') return 'Server running • live data unavailable';
  return 'Server unavailable';
}

function connectAddress(server: ServerView): string | null {
  const snapshot = server.snapshot;
  const host = server.connectDomain ?? snapshot?.host;
  if (host === null || host === undefined) return null;
  return snapshot?.port === null || snapshot?.port === undefined
    ? host
    : `${host}:${String(snapshot.port)}`;
}

function metric(label: string, value: number | null | undefined, unit: string): string | null {
  return value === null || value === undefined ? null : `${label}: ${value.toFixed(1)} ${unit}`;
}

function color(snapshot: SnapshotView | null): number {
  if (snapshot?.hostingState === 'STOPPED') return 0x747f8d;
  if (
    snapshot?.hostingState === 'RUNNING' &&
    snapshot.gameplayState === 'AVAILABLE' &&
    !snapshot.stale
  )
    return 0x23a55a;
  if (snapshot?.hostingState === 'STARTING' || snapshot?.gameplayState === 'DEGRADED')
    return 0xf0b232;
  return 0xed4245;
}
