import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createGameServerCustomId } from './custom-id.js';

const ASSET_BASE_URL =
  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/game-servers';

const SERVER_INFO_ASSET_BASE_URL =
  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info';

// Discord caches external media by URL. Give revised artwork a new content-versioned
// filename; replacing bytes at the old URL does not refresh already cached cards.
const FALLBACK_BANNER = 'clickcs-arena-banner-779a25c6.jpg';

const SERVER_CARD_DESCRIPTION =
  'Challenge other players 1v1, warm up, or kill time between matches.\n-# Open to all Office Club members.';

const componentType = {
  actionRow: 1,
  button: 2,
  section: 9,
  textDisplay: 10,
  thumbnail: 11,
  mediaGallery: 12,
  separator: 14,
  container: 17,
} as const;

const buttonStyle = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
  link: 5,
} as const;

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
  imageUrl: string | null;
  enabled: boolean;
  public: boolean;
  sortOrder: number;
  providerServerId: string;
  snapshot: SnapshotView | null;
  hasCard?: boolean;
}

export interface CardFingerprint {
  layoutVersion: number;
  accentColor: number | null;
  displayName: string;
  status: string;
  players: string;
  map: string | null;
  location: string | null;
  connectAddress: string | null;
  description: string;
  bannerImageUrl: string;
  thumbnailImageUrl: string;
  hasJoinUrl: boolean;
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
  const selectedHasCard =
    selectedId === undefined
      ? false
      : (servers.find((server) => server.id === selectedId)?.hasCard ?? false);
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
              description: server.hasCard
                ? 'Already added'
                : statusLabel(server.snapshot).slice(0, 100),
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
        .setDisabled(selectedId === undefined || selectedHasCard),
    ),
  );
  return { embeds: [embed], components };
}

export function renderGameServerCard(server: ServerView, secret: string) {
  const snapshot = server.snapshot;
  const location = displayLocation(snapshot?.datacenter ?? null);
  const map = snapshot?.map ?? null;
  const displayMap = displayMapName(map);
  const description = cardDescription(server);
  const mapImageUrl = resolveMapImageUrl(map, server.imageUrl);

  const headerComponents: Record<string, unknown>[] = [
    textDisplay(
      `# ${server.displayName}\n## ${statusEmoji(snapshot)} ${statusLabel(snapshot)}${location === null ? '' : ` · ${location}`}\n${playerCount(snapshot).toLowerCase()}`,
    ),
  ];

  const headerSection = {
    type: componentType.section,
    components: headerComponents,
    accessory: {
      type: componentType.thumbnail,
      media: { url: serverIdentityIconUrl() },
    },
  };

  const mapGallery = {
    type: componentType.mediaGallery,
    items: [
      {
        media: { url: mapImageUrl },
        description: `${displayMap} map artwork`,
      },
    ],
  };

  const actionRow = {
    type: componentType.actionRow,
    components: [connectButton(server, secret), mapRulesButton(server, secret)],
  };

  const container: Record<string, unknown> = {
    type: componentType.container,
    accentColor: 0x2b8aef,
    components: [
      headerSection,
      textDisplay(description),
      { type: componentType.separator, divider: true, spacing: 1 },
      textDisplay(`**Current map**\n\`${displayMap}\``),
      mapGallery,
      textDisplay(`\`${connectAddress(server) ?? 'Unavailable'}\``),
      actionRow,
    ],
  };

  return {
    components: [container] as unknown[],
    flags: MessageFlags.IsComponentsV2 as number,
    allowedMentions: { parse: [] },
  };
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
  const map = snapshot?.map ?? null;
  const displayMap = displayMapName(map);
  return {
    layoutVersion: 13,
    accentColor: 0x2b8aef,
    displayName: server.displayName,
    status: statusLabel(snapshot),
    players: playerCount(snapshot),
    map: displayMap,
    location: displayLocation(snapshot?.datacenter ?? null),
    connectAddress: connectAddress(server),
    description: cardDescription(server),
    bannerImageUrl: resolveMapImageUrl(map, server.imageUrl),
    thumbnailImageUrl: serverIdentityIconUrl(),
    hasJoinUrl: server.joinUrl !== null,
  };
}

function connectButton(server: ServerView, secret: string): Record<string, unknown> {
  return {
    type: componentType.button,
    style: buttonStyle.primary,
    label: 'Connect',
    emoji: { name: '▶' },
    customId: createGameServerCustomId({ action: 'connect', value: server.id }, secret),
  };
}

function mapRulesButton(server: ServerView, secret: string): Record<string, unknown> {
  return {
    type: componentType.button,
    style: buttonStyle.secondary,
    label: 'Map & Rules',
    emoji: { name: '🗺' },
    customId: createGameServerCustomId({ action: 'map-rules', value: server.id }, secret),
  };
}

function textDisplay(content: string): Record<string, unknown> {
  return { type: componentType.textDisplay, content };
}

function displayLocation(location: string | null): string | null {
  const trimmed = location?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase());
}

// Custom status emoji IDs are supplied through the deployment environment.
//
// Before deploying:
// 1. Upload the PNGs from assets/game-servers/status-emojis/ to this Discord server.
// 2. Copy the numeric Discord emoji IDs.
// 3. Set these environment variables for the app container:
//      GAME_SERVER_EMOJI_ONLINE_ID
//      GAME_SERVER_EMOJI_OFFLINE_ID
//      GAME_SERVER_EMOJI_WARNING_ID
//      GAME_SERVER_EMOJI_PENDING_ID
//
// The renderer builds standard Discord custom-emoji markup:
//   <:online_dot:123456789012345678>
//
// If an ID is missing, a small text bullet is used instead so the card still renders.
function customStatusEmoji(name: string, id: string | undefined): string {
  const trimmedId = id?.trim();
  return trimmedId ? `<:${name}:${trimmedId}>` : '•';
}

function statusEmoji(snapshot: SnapshotView | null): string {
  if (snapshot === null) {
    return customStatusEmoji('pending_dot', process.env.GAME_SERVER_EMOJI_PENDING_ID);
  }

  if (snapshot.stale) {
    return customStatusEmoji('warning_dot', process.env.GAME_SERVER_EMOJI_WARNING_ID);
  }

  if (snapshot.hostingState === 'RUNNING' && snapshot.gameplayState === 'AVAILABLE') {
    return customStatusEmoji('online_dot', process.env.GAME_SERVER_EMOJI_ONLINE_ID);
  }

  if (snapshot.hostingState === 'STARTING' || snapshot.gameplayState === 'DEGRADED') {
    return customStatusEmoji('warning_dot', process.env.GAME_SERVER_EMOJI_WARNING_ID);
  }

  return customStatusEmoji('offline_dot', process.env.GAME_SERVER_EMOJI_OFFLINE_ID);
}

function playerCount(snapshot: SnapshotView | null): string {
  if (snapshot === null || snapshot.players === null) return 'Unknown players';
  const max = snapshot.maxPlayers;
  return max === null
    ? `${String(snapshot.players)} Players`
    : `${String(snapshot.players)} / ${String(max)} Players`;
}

function statusLabel(snapshot: SnapshotView | null): string {
  if (snapshot === null) return 'Status pending';
  if (snapshot.hostingState === 'STOPPED') return 'Offline';
  if (snapshot.hostingState === 'STARTING') return 'Server starting…';
  if (snapshot.stale) return 'Status stale';
  if (snapshot.hostingState === 'RUNNING' && snapshot.gameplayState === 'AVAILABLE')
    return 'Online';
  if (snapshot.hostingState === 'RUNNING') return 'Server running • live data unavailable';
  return 'Server unavailable';
}

export function connectAddress(server: ServerView): string | null {
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

export function resolveMapImageUrl(
  map: string | null,
  serverImageUrl: string | null,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const displayMap = displayMapName(map);
  // Only canonical map filenames may participate in local asset lookup.
  if (displayMap !== 'Unknown' && /^[a-zA-Z0-9_-]+$/.test(displayMap)) {
    for (const ext of ['webp', 'png', 'jpg']) {
      const localPath = path.join(
        process.cwd(),
        'assets',
        'game-servers',
        'maps',
        `${displayMap}.${ext}`,
      );
      if (fileExists(localPath)) {
        return `${ASSET_BASE_URL}/maps/${displayMap}.${ext}`;
      }
    }
  }
  if (serverImageUrl !== null) return serverImageUrl;
  return `${ASSET_BASE_URL}/maps/fallback/${FALLBACK_BANNER}`;
}

function serverIdentityIconUrl(): string {
  return `${SERVER_INFO_ASSET_BASE_URL}/clickcs-server-thumbnail.png`;
}

export function displayMapName(map: string | null): string {
  const trimmed = map?.trim();
  if (!trimmed) return 'Unknown';
  const canonical = trimmed.replace(/^workshop\/\d+\//i, '').replace(/\.bsp$/i, '');
  return canonical || 'Unknown';
}

function cardDescription(server: ServerView): string {
  return server.description?.trim() || SERVER_CARD_DESCRIPTION;
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
