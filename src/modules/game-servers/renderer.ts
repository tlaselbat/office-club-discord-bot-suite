import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  cardAccentColor,
  DEFAULT_CARD_DESCRIPTION,
  isHttpsUrl,
  resolveCardProfile,
  resolveCardLayout,
  type CardLayoutElement,
  type CardButton,
  type CardLineStyle,
} from './card-profile.js';
import { createGameServerCustomId } from './custom-id.js';

const ASSET_BASE_URL =
  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/game-servers';

// Discord caches external media by URL. Give revised artwork a new content-versioned
// filename; replacing bytes at the old URL does not refresh already cached cards.
const FALLBACK_BANNER = 'clickcs-arena-banner-26bc6af7.jpg';

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
  guildId: string;
  displayName: string;
  description: string | null;
  connectDomain: string | null;
  joinUrl: string | null;
  imageUrl: string | null;
  cardProfile?: unknown;
  enabled: boolean;
  public: boolean;
  sortOrder: number;
  providerServerId: string;
  snapshot: SnapshotView | null;
  hasCard?: boolean;
  updateThreads?: UpdateThreadView[];
}

export interface UpdateThreadView {
  type: 'ANNOUNCEMENTS' | 'CHANGELOG';
  threadId: string;
  latestMessageText: string | null;
  latestMessageAt: Date | null;
  notificationExpiresAt: Date | null;
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
  joinUrl: string | null;
  statusEmoji: string;
  cardProfile: unknown;
  lastSuccessfulAt: string | null;
  updateThreads: Array<{
    type: UpdateThreadView['type'];
    threadId: string;
    latestMessageText: string | null;
    latestMessageAt: string | null;
    notificationExpiresAt: string | null;
  }>;
}

export function renderAddGameServersPanel(
  servers: ServerView[],
  secret: string,
  targetChannelId: string,
  selectedId?: string,
  ownerId?: string,
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
          .setCustomId(
            createGameServerCustomId(
              {
                action: 'select',
                name: targetChannelId,
                ...(ownerId === undefined ? {} : { ownerId }),
              },
              secret,
            ),
          )
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
            {
              action: 'add',
              ...(selectedId === undefined ? {} : { value: selectedId }),
              name: targetChannelId,
              ...(ownerId === undefined ? {} : { ownerId }),
            },
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
  const mapImageUrl = resolveMapImageUrl(map, server.imageUrl);
  const profile = resolveCardProfile(server.cardProfile);
  const values = cardPlaceholderValues(server, profile, location);
  const layout = resolveCardLayout(server.cardProfile, server.description);
  return renderLayoutCard(server, secret, profile, values, layout, mapImageUrl, displayMap);
}

function renderLayoutCard(
  server: ServerView,
  secret: string,
  profile: ReturnType<typeof resolveCardProfile>,
  values: Record<string, string>,
  layout: ReturnType<typeof resolveCardLayout>,
  mapImageUrl: string,
  displayMap: string,
) {
  const components: Record<string, unknown>[] = [];
  const renderedUpdates = new Map(
    layout
      .filter(
        (element): element is Extract<CardLayoutElement, { type: 'updates' }> =>
          element.type === 'updates',
      )
      .map((element) => [
        element.id,
        element.visible
          ? renderUpdatesSection(server, element, values, mapImageUrl, displayMap)
          : [],
      ]),
  );
  const buttons = new Map((profile.layout?.buttons ?? []).map((button) => [button.id, button]));
  for (const [index, element] of layout.entries()) {
    if (!element.visible) continue;
    if (element.type === 'text') {
      const update = resolveTextRowUpdates(server, element);
      if (!update.visible) continue;
      const rowValues = { ...values, ...update.values };
      const content = styleCardLine(
        resolveCardTemplate(element.template, rowValues),
        element.style,
      );
      if (!content.trim()) continue;
      const isUpdateText = Object.keys(update.values).length > 0;
      const display = isUpdateText ? updateTextDisplay(content) : textDisplay(content);
      const thread = element.accessory?.destination
        ? (server.updateThreads ?? []).find((item) => item.type === element.accessory?.destination)
        : undefined;
      const validThread =
        thread !== undefined &&
        /^\d{17,20}$/.test(thread.threadId) &&
        /^\d{17,20}$/.test(server.guildId);
      const hasMessage = Boolean(thread?.latestMessageText?.trim());
      const showAccessory = Boolean(
        !element.accessoryButtonId &&
          element.accessory?.enabled &&
          validThread &&
          element.accessory.visibility !== 'never' &&
          (element.accessory.visibility !== 'message_exists' || hasMessage),
      );
      const configuredButton = element.accessoryButtonId
        ? buttons.get(element.accessoryButtonId)
        : undefined;
      const accessoryButton = configuredButton?.visible
        ? renderConfiguredButton(server, secret, configuredButton)
        : null;
      components.push(
        accessoryButton !== null
          ? { type: componentType.section, components: [display], accessory: accessoryButton }
          : showAccessory
            ? {
                type: componentType.section,
                components: [display],
                accessory: {
                  type: componentType.button,
                  style: buttonStyle.link,
                  label: element.accessory?.label.replace(/@/g, '@\u200b').slice(0, 80) ?? 'Open',
                  url: `https://discord.com/channels/${server.guildId}/${thread?.threadId ?? ''}`,
                },
              }
            : display,
      );
    } else if (element.type === 'section') {
      const update = resolveTextRowUpdates(server, element);
      const sectionText = styleCardLine(
        resolveCardTemplate(element.template, { ...values, ...update.values }),
        element.style,
      );
      const configuredButton = element.accessoryButtonId
        ? buttons.get(element.accessoryButtonId)
        : undefined;
      components.push({
        type: componentType.section,
        components: [textDisplay(sectionText)],
        accessory: (configuredButton?.visible
          ? renderConfiguredButton(server, secret, configuredButton)
          : null) ?? {
          type: componentType.thumbnail,
          media: { url: element.thumbnailUrl ?? profile.thumbnailImageUrl },
        },
      });
    } else if (element.type === 'gallery') {
      const items = element.items.map((item) => ({
        media: {
          url:
            item.source === 'map'
              ? mapImageUrl
              : item.source === 'fallback'
                ? resolveMapImageUrl(null, null)
                : (item.url ?? resolveMapImageUrl(null, null)),
        },
        description: resolveCardTemplate(item.description || `${displayMap} map artwork`, values),
      }));
      components.push({ type: componentType.mediaGallery, items });
    } else if (element.type === 'separator') {
      const following = layout[index + 1];
      if (
        element.label === 'Updates separator' &&
        following?.type === 'updates' &&
        (renderedUpdates.get(following.id)?.length ?? 0) === 0
      )
        continue;
      components.push({
        type: componentType.separator,
        divider: element.divider,
        spacing: element.spacing,
      });
    } else if (element.type === 'actions') {
      const buttons = [
        ...(profile.buttons.connect
          ? [connectButton(server, secret, profile.buttons.connectLabel)]
          : []),
        ...(profile.buttons.mapRules
          ? [mapRulesButton(server, secret, profile.buttons.mapRulesLabel)]
          : []),
      ];
      if (buttons.length) components.push({ type: componentType.actionRow, components: buttons });
    } else if (element.type === 'button_row') {
      const rowButtons = element.buttonIds
        .map((id) => buttons.get(id))
        .filter((button): button is CardButton => button !== undefined && button.visible)
        .map((button) => renderConfiguredButton(server, secret, button))
        .filter((button): button is Record<string, unknown> => button !== null);
      if (rowButtons.length)
        components.push({ type: componentType.actionRow, components: rowButtons });
    } else {
      components.push(...(renderedUpdates.get(element.id) ?? []));
    }
  }
  const withoutOrphanedSeparators = components.filter((component, index) => {
    if (component.type !== componentType.separator) return true;
    const before = components[index - 1];
    const after = components[index + 1];
    return (
      before !== undefined &&
      after !== undefined &&
      before.type !== componentType.separator &&
      after.type !== componentType.separator
    );
  });
  const container: Record<string, unknown> = {
    type: componentType.container,
    accentColor: cardAccentColor(profile.accentColor),
    components: withoutOrphanedSeparators,
  };
  validateRenderedLayout(container);
  enforceTextBudget(container);
  return {
    components: [container] as unknown[],
    flags: MessageFlags.IsComponentsV2 as number,
    allowedMentions: { parse: [] },
  };
}

function renderConfiguredButton(
  server: ServerView,
  secret: string,
  button: CardButton,
): Record<string, unknown> | null {
  const label = button.label.replace(/@/g, '@\u200b').slice(0, 80);
  const emoji = button.emoji ? parseButtonEmoji(button.emoji) : undefined;
  const link =
    button.action === 'external-https-url'
      ? button.destination
      : button.action === 'announcements-thread' || button.action === 'changelog-thread'
        ? (() => {
            const kind = button.action === 'announcements-thread' ? 'ANNOUNCEMENTS' : 'CHANGELOG';
            const thread = (server.updateThreads ?? []).find((item) => item.type === kind);
            return thread &&
              /^\d{17,20}$/.test(thread.threadId) &&
              /^\d{17,20}$/.test(server.guildId)
              ? `https://discord.com/channels/${server.guildId}/${thread.threadId}`
              : null;
          })()
        : null;
  if (link)
    return {
      type: componentType.button,
      style: buttonStyle.link,
      label,
      ...(emoji ? { emoji } : {}),
      url: link,
    };
  if (
    button.action === 'external-https-url' ||
    button.action === 'announcements-thread' ||
    button.action === 'changelog-thread'
  )
    return null;
  const action = button.action;
  return {
    type: componentType.button,
    style: buttonStyle[button.style],
    label,
    ...(emoji ? { emoji } : {}),
    customId: createGameServerCustomId(
      {
        action,
        value: server.id,
        name: createHash('sha256').update(button.id).digest('base64url').slice(0, 8),
      },
      secret,
    ),
  };
}

function parseButtonEmoji(value: string): Record<string, unknown> | undefined {
  const custom = value.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
  if (custom) return { animated: custom[1] === 'a', name: custom[2], id: custom[3] };
  if (value.startsWith('<')) return undefined;
  return { name: value };
}

function validateRenderedLayout(container: Record<string, unknown>): void {
  const children = container.components as Record<string, unknown>[];
  const count = (node: Record<string, unknown>): number =>
    1 +
    ((node.components ?? []) as Record<string, unknown>[]).reduce(
      (total, child) => total + count(child),
      0,
    ) +
    (node.accessory === undefined ? 0 : count(node.accessory as Record<string, unknown>));
  if (count(container) > 40)
    throw new Error('Card layout exceeds Discord’s 40 component message limit.');
  for (const child of children) {
    if (child.type === componentType.section) {
      const content = child.components as Record<string, unknown>[];
      const accessoryType = (child.accessory as Record<string, unknown> | undefined)?.type;
      if (
        content.length < 1 ||
        content.length > 3 ||
        content.some((part) => part.type !== componentType.textDisplay) ||
        ![componentType.thumbnail, componentType.button].includes(accessoryType as 11 | 2)
      )
        throw new Error(
          'Card Sections require one to three text components and a valid accessory.',
        );
    }
    if (
      child.type === componentType.mediaGallery &&
      ((child.items as unknown[]).length < 1 || (child.items as unknown[]).length > 10)
    )
      throw new Error('Discord media galleries require one to ten items.');
    if (child.type === componentType.actionRow && (child.components as unknown[]).length > 5)
      throw new Error('Discord action rows support at most five buttons.');
  }
}

/** Styles apply to the first line only; embedded Markdown remains user controlled. */
export function styleCardLine(content: string, style: CardLineStyle): string {
  if (!content.trim()) return '';
  if (style === 'normal') return content;
  const prefix = { large: '# ', medium: '## ', small: '### ', subtext: '-# ' }[style];
  return prefix + content.replace(/^(?:#{1,3}|-#)\s+/, '');
}

/** Discord permits 4000 text characters across the entire Components V2 message. */
function enforceTextBudget(container: Record<string, unknown>): void {
  const displays: Record<string, unknown>[] = [];
  const visit = (component: Record<string, unknown>) => {
    if (component.type === componentType.textDisplay) displays.push(component);
    for (const child of (component.components ?? []) as Record<string, unknown>[]) visit(child);
  };
  visit(container);
  for (const display of displays) if (!String(display.content).trim()) display.content = '\u200b';
  const priority = displays.filter((display) => display.__updates === true);
  const regular = displays.filter((display) => display.__updates !== true);
  const priorityTotal = priority.reduce((sum, display) => sum + String(display.content).length, 0);
  const regularTotal = regular.reduce((sum, display) => sum + String(display.content).length, 0);
  if (priorityTotal <= 4000 && priorityTotal + regularTotal > 4000) {
    const available = 4000 - priorityTotal - regular.length;
    regular.forEach((display) => {
      const content = String(display.content);
      const limit = Math.max(1, 1 + Math.floor((available * content.length) / regularTotal));
      display.content = content.slice(0, limit - 1) + '…';
    });
    return;
  }
  const total = priorityTotal + regularTotal;
  if (total <= 4000) return;
  // Proportional allocation preserves space for updates even when expanded telemetry is huge.
  const available = 4000 - displays.length;
  for (const display of displays) {
    const content = String(display.content);
    const limit = 1 + Math.floor((available * content.length) / total);
    display.content = content.slice(0, limit - 1) + '\u2026';
  }
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
  const components = !isHttpsUrl(server.joinUrl)
    ? []
    : [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel('Connect').setStyle(ButtonStyle.Link).setURL(server.joinUrl),
        ),
      ];
  return { embeds: [embed], components };
}

export function cardFingerprint(server: ServerView): CardFingerprint {
  const snapshot = server.snapshot;
  const map = snapshot?.map ?? null;
  const displayMap = displayMapName(map);
  const profile = resolveCardProfile(server.cardProfile);
  return {
    layoutVersion: 21,
    accentColor: cardAccentColor(profile.accentColor),
    displayName: server.displayName,
    status: configuredStatusLabel(snapshot, profile),
    players: playerCount(snapshot),
    map: displayMap,
    location: displayLocation(snapshot?.datacenter ?? null),
    connectAddress: connectAddress(server),
    description: cardDescription(server),
    bannerImageUrl: resolveMapImageUrl(map, server.imageUrl),
    thumbnailImageUrl: profile.thumbnailImageUrl,
    joinUrl: isHttpsUrl(server.joinUrl) ? server.joinUrl : null,
    statusEmoji: statusEmoji(snapshot, profile),
    cardProfile: profile,
    lastSuccessfulAt: snapshot?.lastSuccessfulAt?.toISOString() ?? null,
    updateThreads: (server.updateThreads ?? [])
      .map((thread) => ({
        type: thread.type,
        threadId: thread.threadId,
        latestMessageText: thread.latestMessageText,
        latestMessageAt: thread.latestMessageAt?.toISOString() ?? null,
        notificationExpiresAt: thread.notificationExpiresAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  };
}

export function hasFreshUpdate(thread: UpdateThreadView, now = new Date()): boolean {
  return (
    thread.notificationExpiresAt !== null && thread.notificationExpiresAt.getTime() > now.getTime()
  );
}

export function formatRelativeUpdateTimestamp(value: Date, now = new Date()): string {
  if (Number.isNaN(value.getTime())) return '';
  const seconds = (value.getTime() - now.getTime()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1];
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round(seconds / size),
    unit,
  );
}

function renderUpdatesSection(
  server: ServerView,
  element: Extract<CardLayoutElement, { type: 'updates' }>,
  values: Record<string, string>,
  mapImageUrl: string,
  displayMap: string,
): Record<string, unknown>[] {
  const threads = new Map((server.updateThreads ?? []).map((thread) => [thread.type, thread]));
  const renderFeed = (
    type: UpdateThreadView['type'],
    settings: Extract<CardLayoutElement, { type: 'updates' }>['announcements'],
  ): Record<string, unknown>[] | null => {
    if (!settings.visible) return null;
    const thread = threads.get(type);
    const source = thread?.latestMessageText?.trim() ?? '';
    if (element.emptyBehavior === 'hide_empty_entries' && !source) return null;
    const latest = source
      ? escapeUpdateMarkdown(source.slice(0, settings.latestMessageLength))
      : '';
    const safe = (text: string) => text.replace(/@/g, '@\u200b');
    const title = `${safe(settings.displayLabel)}${settings.showNew && thread !== undefined && hasFreshUpdate(thread) ? ' 🆕' : ''}`;
    const timestamp =
      settings.showTimestamp && thread?.latestMessageAt
        ? settings.timestampMode === 'discord_native'
          ? `<t:${String(Math.floor(thread.latestMessageAt.getTime() / 1000))}:R>`
          : formatRelativeUpdateTimestamp(thread.latestMessageAt)
        : '';
    const detail = latest
      ? `${latest}${timestamp ? `\n${timestamp}` : ''}`
      : safe(settings.emptyPlaceholder);
    const titleDisplay = updateTextDisplay(
      styleCardLine(title, updateLineStyle(settings.textStyle)),
    );
    const summaryDisplay = updateTextDisplay(detail);
    const safeThread =
      thread !== undefined &&
      /^\d{17,20}$/.test(thread.threadId) &&
      /^\d{17,20}$/.test(server.guildId);
    return safeThread && settings.showOpenButton
      ? [
          {
            type: componentType.section,
            components: [titleDisplay, summaryDisplay],
            accessory: {
              type: componentType.button,
              style: buttonStyle.link,
              label: settings.openButtonLabel.replace(/@/g, '@\u200b').slice(0, 80),
              url: `https://discord.com/channels/${server.guildId}/${thread.threadId}`,
            },
          },
        ]
      : [titleDisplay, summaryDisplay];
  };
  if (element.blocks !== undefined) {
    const components: Record<string, unknown>[] = [];
    const feedsByType = new Map([
      ['ANNOUNCEMENTS', renderFeed('ANNOUNCEMENTS', element.announcements)],
      ['CHANGELOG', renderFeed('CHANGELOG', element.changelog)],
    ]);
    for (const block of element.blocks) {
      if (!block.visible) continue;
      if (block.type === 'heading') {
        if (element.showHeading)
          components.push(
            updateTextDisplay(
              styleCardLine(
                element.title.replace(/@/g, '@\u200b'),
                updateLineStyle(element.headingStyle),
              ),
            ),
          );
      } else if (block.type === 'feed') {
        components.push(...(feedsByType.get(block.feed) ?? []));
      } else if (block.type === 'text') {
        const updateValues = resolveTextRowUpdates(server, {
          id: block.id,
          type: 'section',
          label: 'Updates text',
          visible: true,
          template: block.template,
          style: block.style,
          timestampMode: block.timestampMode,
          thumbnailUrl: null,
        }).values;
        const content = styleCardLine(
          resolveCardTemplate(block.template, { ...values, ...updateValues }),
          block.style,
        );
        if (content.trim()) components.push(updateTextDisplay(content));
      } else if (block.type === 'separator') {
        components.push({
          type: componentType.separator,
          divider: block.divider,
          spacing: block.spacing,
        });
      } else {
        const items = block.items.map((item) => ({
          media: {
            url:
              item.source === 'map'
                ? mapImageUrl
                : item.source === 'fallback'
                  ? resolveMapImageUrl(null, null)
                  : (item.url ?? resolveMapImageUrl(null, null)),
          },
          description: resolveCardTemplate(item.description || `${displayMap} map artwork`, values),
        }));
        components.push({ type: componentType.mediaGallery, items });
      }
    }
    return components.filter((part, index) => {
      if (part.type !== componentType.separator) return true;
      const before = components[index - 1];
      const after = components[index + 1];
      return (
        before !== undefined &&
        after !== undefined &&
        before.type !== componentType.separator &&
        after.type !== componentType.separator
      );
    });
  }
  const feeds = element.feedOrder
    .map((type) =>
      renderFeed(type, type === 'ANNOUNCEMENTS' ? element.announcements : element.changelog),
    )
    .filter((feed): feed is Record<string, unknown>[] => feed !== null);
  if (!feeds.length) return [];
  return [
    ...(element.showHeading
      ? [
          updateTextDisplay(
            styleCardLine(
              element.title.replace(/@/g, '@\u200b'),
              updateLineStyle(element.headingStyle),
            ),
          ),
        ]
      : []),
    ...feeds.flatMap((feed, index) => [
      ...(index > 0 && element.separator.enabled
        ? [
            {
              type: componentType.separator,
              divider: element.separator.divider,
              spacing: element.separator.spacing,
            },
          ]
        : []),
      ...feed,
    ]),
  ];
}

function updateTextDisplay(content: string): Record<string, unknown> {
  const display = textDisplay(content);
  Object.defineProperty(display, '__updates', { value: true });
  return display;
}

function updateLineStyle(style: 'normal' | 'heading' | 'subtext'): CardLineStyle {
  return style === 'heading' ? 'large' : style;
}

function connectButton(server: ServerView, secret: string, label: string): Record<string, unknown> {
  return {
    type: componentType.button,
    style: buttonStyle.primary,
    label,
    emoji: { name: '▶' },
    customId: createGameServerCustomId({ action: 'connect', value: server.id }, secret),
  };
}

function mapRulesButton(
  server: ServerView,
  secret: string,
  label: string,
): Record<string, unknown> {
  return {
    type: componentType.button,
    style: buttonStyle.secondary,
    label,
    emoji: { name: '🗺' },
    customId: createGameServerCustomId({ action: 'map-rules', value: server.id }, secret),
  };
}

function textDisplay(content: string): Record<string, unknown> {
  return { type: componentType.textDisplay, content };
}

export function cardPlaceholderValues(
  server: ServerView,
  profile: ReturnType<typeof resolveCardProfile>,
  location: string | null = displayLocation(server.snapshot?.datacenter ?? null),
): Record<string, string> {
  const snapshot = server.snapshot;
  const host = server.connectDomain ?? snapshot?.host ?? '';
  const port = snapshot?.port === null || snapshot?.port === undefined ? '' : String(snapshot.port);
  const address = host ? (port ? `${host}:${port}` : host) : '';
  const players = snapshot?.players;
  const maxPlayers = snapshot?.maxPlayers;
  const count = players === null || players === undefined ? '' : String(players);
  const max = maxPlayers === null || maxPlayers === undefined ? '' : String(maxPlayers);
  const icon = statusEmoji(snapshot, profile);
  const status = configuredStatusLabel(snapshot, profile);
  const elapsed = snapshot?.lastSuccessfulAt
    ? Math.max(0, Math.floor((Date.now() - snapshot.lastSuccessfulAt.getTime()) / 60_000))
    : null;
  const lastUpdated = elapsed === null ? '' : elapsed < 1 ? 'Just now' : `${String(elapsed)}m ago`;
  return {
    playercount: count ? (max ? `${count}/${max}` : count) : 'Unknown',
    players: count,
    maxplayers: max,
    online: `${icon} ${status}`,
    status,
    statusicon: icon,
    location: location ?? '',
    serveraddress: address || 'Unavailable',
    severaddress: address || 'Unavailable',
    serverip: host,
    serverport: port,
    currentmap: displayMapName(snapshot?.map ?? null),
    servername: server.displayName,
    lastupdated: lastUpdated,
  };
}

function resolveTextRowUpdates(
  server: ServerView,
  element: Extract<CardLayoutElement, { type: 'text' | 'section' }>,
): { visible: boolean; values: Record<string, string> } {
  const threads = new Map((server.updateThreads ?? []).map((thread) => [thread.type, thread]));
  const source =
    element.type === 'text'
      ? (element.conditionalVisibility?.source ?? 'ANNOUNCEMENTS')
      : 'ANNOUNCEMENTS';
  const conditionThread = threads.get(source);
  const conditionHasMessage = Boolean(conditionThread?.latestMessageText?.trim());
  const mode =
    element.type === 'text' ? (element.conditionalVisibility?.mode ?? 'always') : 'always';
  if (mode === 'thread_exists' && !conditionThread) return { visible: false, values: {} };
  if (mode === 'message_exists' && !conditionHasMessage) return { visible: false, values: {} };
  if (
    mode === 'any_update_visible' &&
    ![...threads.values()].some((thread) => thread.latestMessageText?.trim())
  )
    return { visible: false, values: {} };

  const usesUpdateTokens = /\{(?:announcements|changelog)\.(?:preview|time|new|url)\}/i.test(
    element.template,
  );
  if (!usesUpdateTokens) return { visible: true, values: {} };
  const max = element.type === 'text' ? (element.previewLength ?? 140) : 140;
  const selectedSource = source;
  const selectedThread = threads.get(selectedSource);
  if (
    element.type === 'text' &&
    element.emptyBehavior === 'hide' &&
    !selectedThread?.latestMessageText?.trim()
  )
    return { visible: false, values: {} };
  const tokenValues: Record<string, string> = {};
  for (const selectedFeed of ['ANNOUNCEMENTS', 'CHANGELOG'] as const) {
    const thread = threads.get(selectedFeed);
    const rawText = thread?.latestMessageText?.trim() ?? '';
    const excerpt = rawText
      ? escapeUpdateMarkdown(truncateUpdateExcerpt(rawText, max))
      : element.type === 'text' && element.emptyBehavior === 'fallback'
        ? selectedFeed === selectedSource
          ? escapeUpdateMarkdown(element.emptyText ?? 'No updates yet.')
          : ''
        : '';
    const safeUrl =
      thread && /^\d{17,20}$/.test(thread.threadId) && /^\d{17,20}$/.test(server.guildId)
        ? `https://discord.com/channels/${server.guildId}/${thread.threadId}`
        : '';
    const prefix = selectedFeed === 'ANNOUNCEMENTS' ? 'announcements' : 'changelog';
    tokenValues[`${prefix}.preview`] = excerpt;
    tokenValues[`${prefix}.time`] = thread?.latestMessageAt
      ? element.timestampMode === 'discord_native'
        ? `<t:${String(Math.floor(thread.latestMessageAt.getTime() / 1000))}:R>`
        : formatRelativeUpdateTimestamp(thread.latestMessageAt)
      : '';
    tokenValues[`${prefix}.new`] = thread && hasFreshUpdate(thread) ? '🆕' : '';
    tokenValues[`${prefix}.url`] = safeUrl;
  }
  return { visible: true, values: tokenValues };
}

function escapeUpdateMarkdown(value: string): string {
  return value.replace(/@/g, '@\u200b').replace(/([\\\x60*_{}<>\x5b\x5d()#+\-.!|>~])/g, '\\$1');
}

function truncateUpdateExcerpt(value: string, max: number): string {
  const normalized = value.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1))}…` : normalized;
}

export function resolveCardTemplate(template: string, values: Record<string, string>): string {
  const withoutMissingLocationSeparator = values.location
    ? template
    : template.replace(/\s?[·|]\s*\{location\}/gi, '');
  const withoutMissingUpdateTimestamp = withoutMissingLocationSeparator.replace(
    /\r?\n(?:-#\s*)?\{(announcements|changelog)\.time\}/gi,
    (match, feed: string) => (values[`${feed.toLowerCase()}.time`] ? match : ''),
  );
  return withoutMissingUpdateTimestamp.replace(/\{([^{}]+)\}/g, (_match, rawName: string) => {
    const value = values[rawName.toLowerCase()] ?? '';
    // Telemetry and configured text must never trigger Discord mentions.
    return value.replace(/@(?!\u200b)/g, '@\u200b').replace(/`/g, '\\`');
  });
}

function configuredStatusLabel(
  snapshot: SnapshotView | null,
  profile: ReturnType<typeof resolveCardProfile>,
): string {
  if (snapshot === null) return profile.statusLabels.pending;
  if (snapshot.stale) return profile.statusLabels.stale;
  if (snapshot.hostingState === 'STOPPED') return profile.statusLabels.offline;
  if (snapshot.hostingState === 'STARTING') return profile.statusLabels.starting;
  if (snapshot.hostingState === 'RUNNING' && snapshot.gameplayState === 'AVAILABLE')
    return profile.statusLabels.online;
  return profile.statusLabels.unavailable;
}

function displayLocation(location: string | null): string | null {
  const trimmed = location?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase());
}

// Custom Discord status emoji IDs.
//
// Upload these four custom emojis to the guild before deployment:
//   online_dot
//   offline_dot
//   warning_dot
//   pending_dot
//
// Then expose their numeric Discord emoji IDs to the bot process through:
//   GAME_SERVER_EMOJI_ONLINE_ID
//   GAME_SERVER_EMOJI_OFFLINE_ID
//   GAME_SERVER_EMOJI_WARNING_ID
//   GAME_SERVER_EMOJI_PENDING_ID
//
// The PNGs use a 128x128 transparent canvas with a 64x64 visible circle,
// which makes the visible dot appear about half the diameter of a normal
// full-frame Discord emoji.
function customStatusEmoji(name: string, id: string | null): string {
  // Keep the card readable even if one of the deployment variables is missing.
  // The fallback is intentionally a small text dot rather than a full-size
  // Unicode colored-circle emoji.
  return id === null ? '•' : `<:${name}:${id}>`;
}

function statusEmoji(
  snapshot: SnapshotView | null,
  profile = resolveCardProfile(undefined),
): string {
  if (snapshot === null) {
    return customStatusEmoji('pending_dot', profile.pendingEmojiId);
  }

  if (snapshot.stale) {
    return customStatusEmoji('warning_dot', profile.warningEmojiId);
  }

  if (snapshot.hostingState === 'RUNNING' && snapshot.gameplayState === 'AVAILABLE') {
    return customStatusEmoji('online_dot', profile.onlineEmojiId);
  }

  if (snapshot.hostingState === 'STARTING' || snapshot.gameplayState === 'DEGRADED') {
    return customStatusEmoji('warning_dot', profile.warningEmojiId);
  }

  return customStatusEmoji('offline_dot', profile.offlineEmojiId);
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
  if (snapshot.stale) return 'Status stale';
  if (snapshot.hostingState === 'STOPPED') return 'Offline';
  if (snapshot.hostingState === 'STARTING') return 'Server starting…';
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
  if (isHttpsUrl(serverImageUrl)) return serverImageUrl;
  return `${ASSET_BASE_URL}/maps/fallback/${FALLBACK_BANNER}`;
}

export function displayMapName(map: string | null): string {
  const trimmed = map?.trim();
  if (!trimmed) return 'Unknown';
  const canonical = trimmed.replace(/^workshop\/\d+\//i, '').replace(/\.bsp$/i, '');
  return canonical || 'Unknown';
}

function cardDescription(server: ServerView): string {
  return server.description?.trim() || DEFAULT_CARD_DESCRIPTION;
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
