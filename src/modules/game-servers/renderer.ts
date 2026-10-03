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

export function renderGameServerPanel(servers: ServerView[], secret: string) {
  const onlinePlayers = servers.reduce(
    (sum, server) =>
      sum + (server.snapshot?.hostingState === 'RUNNING' ? (server.snapshot.players ?? 0) : 0),
    0,
  );
  const capacity = servers.reduce((sum, server) => sum + (server.snapshot?.maxPlayers ?? 0), 0);
  const lines = servers.map((server) => renderSummary(server));
  const embed = new EmbedBuilder()
    .setColor(0x2b8aef)
    .setTitle('OFFICE CLUB • GAME SERVERS')
    .setDescription(
      lines.length === 0
        ? 'No public game servers are configured.'
        : `Live status for all official Office Club game servers.\n\n${lines.join('\n\n')}`,
    )
    .setFooter({
      text: `Players Online: ${String(onlinePlayers)} / ${String(capacity)} • Cached status`,
    });
  const components: (
    | ActionRowBuilder<StringSelectMenuBuilder>
    | ActionRowBuilder<ButtonBuilder>
  )[] = [];
  if (servers.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(createGameServerCustomId({ action: 'view' }, secret))
          .setPlaceholder('Select Server')
          .addOptions(
            servers.slice(0, 25).map((server) => ({
              label: server.displayName.slice(0, 100),
              value: server.id,
              description: statusLabel(server.snapshot).slice(0, 100),
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createGameServerCustomId({ action: 'refresh' }, secret))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
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

function renderSummary(server: ServerView): string {
  const snapshot = server.snapshot;
  const players =
    snapshot?.hostingState !== 'RUNNING' || snapshot.players === null
      ? ''
      : `\n${String(snapshot.players)}${snapshot.maxPlayers === null ? '' : ` / ${String(snapshot.maxPlayers)}`} players`;
  const map = snapshot?.map === null || snapshot?.map === undefined ? '' : ` • ${snapshot.map}`;
  const location =
    snapshot?.datacenter === null || snapshot?.datacenter === undefined
      ? ''
      : `\n${snapshot.datacenter}`;
  const address = connectAddress(server);
  return `**${server.displayName}** — ${statusLabel(snapshot)}${players}${map}${location}${address === null ? '' : `\n${address}`}`;
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
