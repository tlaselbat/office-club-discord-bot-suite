import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, ComponentType, ContainerBuilder, type APIContainerComponent } from 'discord.js';
import {
  renderAddGameServersPanel,
  renderGameServerCard,
  renderGameServerDetail,
  resolveMapImageUrl,
  displayMapName,
  cardFingerprint,
  styleCardLine,
  cardPlaceholderValues,
  resolveCardTemplate,
  type ServerView,
  type UpdateThreadView,
} from '../../../../src/modules/game-servers/renderer.js';

import {
  CARD_PLACEHOLDERS,
  CARD_LINE_IDS,
  resolveCardLines,
  resolveCardLayout,
  resolveCardProfile,
} from '../../../../src/modules/game-servers/card-profile.js';

const baseSnapshot = {
  hostingState: 'RUNNING',
  gameplayState: 'AVAILABLE',
  host: '192.0.2.1',
  hostname: '1v1 Arena',
  port: 27015,
  datacenter: 'Los Angeles',
  map: 'aim_map_office',
  players: 0,
  maxPlayers: 16,
  cpuPercent: null,
  memoryUsageMb: null,
  averagePingMs: 31,
  packetLossPercent: null,
  serverVarMs: null,
  observedAt: new Date('2026-10-03T00:00:00.000Z'),
  monitoringObservedAt: new Date('2026-10-03T00:00:00.000Z'),
  lastSuccessfulAt: new Date('2026-10-03T00:00:00.000Z'),
  lastOnlineAt: new Date('2026-10-03T00:00:00.000Z'),
  stale: false,
} as const;

const server: ServerView = {
  guildId: '123456789012345678',
  id: '513af1bb-31fa-4b17-bd2e-2ec450984cea',
  providerServerId: 'provider-1',
  displayName: '1v1 Arena',
  description: null,
  enabled: true,
  public: true,
  connectDomain: 'arena.example.com',
  joinUrl: null,
  imageUrl: null,
  sortOrder: 0,
  snapshot: { ...baseSnapshot },
};

const secret = 'secret';

const statusEmojiEnvironment = [
  'GAME_SERVER_EMOJI_ONLINE_ID',
  'GAME_SERVER_EMOJI_OFFLINE_ID',
  'GAME_SERVER_EMOJI_WARNING_ID',
  'GAME_SERVER_EMOJI_PENDING_ID',
] as const;

beforeEach(() => {
  for (const key of statusEmojiEnvironment) vi.stubEnv(key, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function firstContainer(result: ReturnType<typeof renderGameServerCard>): Record<string, unknown> {
  expect(result.components).toHaveLength(1);
  return result.components[0] as Record<string, unknown>;
}

function containerComponents(container: Record<string, unknown>): Record<string, unknown>[] {
  return container.components as Record<string, unknown>[];
}

function textContents(container: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const component of containerComponents(container)) {
    if (component.type === 9) {
      for (const child of component.components as Record<string, unknown>[]) {
        parts.push(String(child.content));
      }
    } else if (component.type === 10) {
      parts.push(String(component.content));
    }
  }
  return parts.join('\n');
}

function actionRow(container: Record<string, unknown>): Record<string, unknown> {
  const components = containerComponents(container);
  const row = components.find((component) => component.type === 1);
  expect(row?.type).toBe(1);
  return row as Record<string, unknown>;
}

function buttons(container: Record<string, unknown>): Record<string, unknown>[] {
  return actionRow(container).components as Record<string, unknown>[];
}

function componentCount(component: Record<string, unknown>): number {
  const children = component.components as Record<string, unknown>[] | undefined;
  const accessory = component.accessory as Record<string, unknown> | undefined;
  return (
    1 +
    (children?.reduce((total, child) => total + componentCount(child), 0) ?? 0) +
    (accessory === undefined ? 0 : componentCount(accessory))
  );
}

describe('Game Server rendering', () => {
  it('applies the selected text style inside a valid thumbnail section', () => {
    const result = renderGameServerCard(
      {
        ...server,
        cardProfile: {
          layout: {
            version: 1,
            elements: [
              {
                id: '123e4567-e89b-42d3-a456-426614174001',
                type: 'section',
                label: 'Header',
                template: '{servername}',
                style: 'medium',
                visible: true,
                thumbnailUrl: null,
              },
            ],
          },
          visibleFields: { updates: false },
        },
      },
      secret,
    );
    const container = result.components[0] as {
      components: Array<{
        type: number;
        components: Array<{ content: string }>;
        accessory: { type: number };
      }>;
    };
    expect(container.components[0]?.type).toBe(9);
    expect(container.components[0]?.components[0]?.content).toBe('## 1v1 Arena');
    expect(container.components[0]?.accessory.type).toBe(11);
  });
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    'renders populated and empty update rows (%s, %s) as native valid components',
    (announcements, changelog) => {
      const postedAt = new Date('2026-10-04T12:00:00Z');
      const views: UpdateThreadView[] = (['ANNOUNCEMENTS', 'CHANGELOG'] as const).map(
        (type, index) => ({
          type,
          threadId: String(100000000000000010n + BigInt(index)),
          latestMessageText: (index === 0 ? announcements : changelog) ? `${type} update` : null,
          latestMessageAt: (index === 0 ? announcements : changelog) ? postedAt : null,
          notificationExpiresAt: null,
        }),
      );
      const container = firstContainer(
        renderGameServerCard({ ...server, updateThreads: views }, secret),
      );
      const text = textContents(container);
      expect(text).toContain('Latest Updates');
      expect(text).toContain(announcements ? 'ANNOUNCEMENTS update' : 'No announcements yet.');
      expect(text).toContain(changelog ? 'CHANGELOG update' : 'No changelog entries yet.');
      if (announcements || changelog)
        expect(text).toContain(`<t:${String(postedAt.getTime() / 1000)}:R>`);
      const components = containerComponents(container);
      const heading = components.find(
        (component) =>
          component.type === ComponentType.TextDisplay &&
          String(component.content).includes('Latest Updates'),
      );
      expect(heading).toEqual({ type: ComponentType.TextDisplay, content: '**Latest Updates**' });
      const sections = components.filter(
        (component) =>
          component.type === ComponentType.Section &&
          (component.accessory as { label?: string } | undefined)?.label === 'Open',
      );
      for (const [index, section] of sections.entries()) {
        const title = (section.components as Record<string, unknown>[])[0];
        expect(section.type).toBe(ComponentType.Section);
        expect(title?.content).toBe(index === 0 ? '📢 **Announcements**' : '🛠 **Changelog**');
        expect(section.accessory).toMatchObject({
          style: 5,
          label: 'Open',
          url: `https://discord.com/channels/${server.guildId}/${views[index]?.threadId ?? ''}`,
        });
        const summary = components[components.indexOf(section) + 1];
        expect(summary).toMatchObject({
          type: ComponentType.TextDisplay,
          content: expect.stringContaining(
            index === 0
              ? announcements
                ? 'ANNOUNCEMENTS update'
                : 'No announcements yet.'
              : changelog
                ? 'CHANGELOG update'
                : 'No changelog entries yet.',
          ),
        });
      }
      const client = new Client({ intents: [] });
      const api = client.options.jsonTransformer?.(container) as APIContainerComponent;
      expect(() => new ContainerBuilder(api).toJSON()).not.toThrow();
      expect(api.components.length).toBeLessThanOrEqual(40);
      expect(componentCount(container)).toBeLessThanOrEqual(40);
    },
  );

  it('expires NEW independently at the exact boundary and fingerprints all cached update fields', () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2026-10-04T12:00:00Z');
      vi.setSystemTime(now);
      const first: UpdateThreadView = {
        type: 'ANNOUNCEMENTS',
        threadId: '100000000000000010',
        latestMessageText: 'News',
        latestMessageAt: now,
        notificationExpiresAt: new Date(now.getTime() + 1000),
      };
      const second: UpdateThreadView = {
        ...first,
        type: 'CHANGELOG',
        threadId: '100000000000000011',
        notificationExpiresAt: new Date(now.getTime() + 2000),
      };
      const view = { ...server, updateThreads: [first, second] };
      expect(
        textContents(firstContainer(renderGameServerCard(view, secret))).match(/🆕/g),
      ).toHaveLength(2);
      vi.setSystemTime(new Date(now.getTime() + 1000));
      let text = textContents(firstContainer(renderGameServerCard(view, secret)));
      expect(text).not.toContain('**Announcements** 🆕');
      expect(text).toContain('**Changelog** 🆕');
      vi.setSystemTime(new Date(now.getTime() + 2000));
      text = textContents(firstContainer(renderGameServerCard(view, secret)));
      expect(text).not.toContain('🆕');
      expect(text).toContain('News');
      for (const changes of [
        { threadId: 'new' },
        { latestMessageText: 'Changed' },
        { latestMessageAt: new Date(0) },
        { notificationExpiresAt: null },
      ]) {
        expect(
          cardFingerprint({ ...view, updateThreads: [{ ...first, ...changes }, second] }),
        ).not.toEqual(cardFingerprint(view));
      }
      expect(cardFingerprint(view).layoutVersion).toBe(19);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders customized Updates in layout order with independent feed visibility and safe links', () => {
    const layout = resolveCardLayout({});
    const updates = layout.find((element) => element.type === 'updates');
    if (!updates) throw new Error('Expected Updates layout element');
    const customized = {
      ...updates,
      title: 'Community Brief',
      emptyBehavior: 'hide_empty_entries' as const,
      announcements: {
        ...updates.announcements,
        visible: false,
        latestMessageLength: 40,
      },
      changelog: {
        ...updates.changelog,
        displayLabel: 'Patch notes',
        textStyle: 'heading' as const,
        openButtonLabel: 'Read notes',
        latestMessageLength: 40,
      },
    };
    const ordered = layout.map((element) => (element.type === 'updates' ? customized : element));
    const result = renderGameServerCard(
      {
        ...server,
        cardProfile: { layout: { version: 2, elements: ordered } },
        updateThreads: [
          {
            type: 'CHANGELOG',
            threadId: '100000000000000011',
            latestMessageText: 'A'.repeat(100),
            latestMessageAt: new Date('2026-10-04T12:00:00Z'),
            notificationExpiresAt: null,
          },
        ],
      },
      secret,
    );
    const container = firstContainer(result);
    const contents = containerComponents(container).flatMap((component) =>
      component.type === ComponentType.Section
        ? (component.components as Record<string, unknown>[]).map((child) => String(child.content))
        : component.type === ComponentType.TextDisplay
          ? [String(component.content)]
          : [],
    );
    expect(contents.join('\n')).toContain('Community Brief');
    expect(contents.join('\n')).toContain('# Patch notes');
    expect(contents.join('\n')).not.toContain('Announcements');
    expect(contents.join('\n')).not.toContain('A'.repeat(41));
    const components = containerComponents(container);
    const changelog = components.find(
      (component) =>
        component.type === ComponentType.Section &&
        (component.components as Record<string, unknown>[]).some(
          (child) => child.content === '# Patch notes',
        ),
    );
    if (!changelog) throw new Error('Expected Changelog title row');
    expect(changelog.accessory).toMatchObject({
      style: 5,
      label: 'Read notes',
      url: 'https://discord.com/channels/123456789012345678/100000000000000011',
    });
    expect((changelog.components as Record<string, unknown>[])[0]?.content).toBe('# Patch notes');
    expect(components[components.indexOf(changelog) + 1]).toMatchObject({
      type: ComponentType.TextDisplay,
      content: expect.stringContaining('A'.repeat(40)),
    });
    expect(result.allowedMentions).toEqual({ parse: [] });
  });

  it('versions the fallback URL with the actual banner content to prevent stale Discord media', () => {
    const filename = new URL(resolveMapImageUrl(null, null)).pathname.split('/').at(-1);
    if (!filename) throw new Error('Expected a fallback banner filename');
    const bytes = readFileSync(`assets/game-servers/maps/fallback/${filename}`);
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    expect(filename).toBe(`clickcs-arena-banner-${version}.jpg`);
  });

  it('serializes to valid Discord API components through the installed discord.js transformer', () => {
    const client = new Client({ intents: [] });
    const container = firstContainer(renderGameServerCard(server, secret));
    const transform = client.options.jsonTransformer;
    if (transform === undefined) throw new Error('Expected the default Discord JSON transformer');
    const api = transform(container) as APIContainerComponent;
    expect(api.accent_color).toBe(0x2b8aef);
    expect(() => new ContainerBuilder(api).toJSON()).not.toThrow();
    const row = api.components.find((component) => component.type === ComponentType.ActionRow);
    expect(row?.type).toBe(1);
    if (row?.type === ComponentType.ActionRow) {
      expect(row.components).toHaveLength(2);
      expect(row.components[0]).toHaveProperty('custom_id', expect.stringMatching(/^gs:connect:/));
    }
  });

  it('renders Add Game Servers panel with title and Add Server button', () => {
    const result = renderAddGameServersPanel([server], secret, 'channel-1');
    const embed = result.embeds[0]?.toJSON();
    expect(embed?.title).toBe('OFFICE CLUB • ADD GAME SERVERS');
    expect(embed?.description).toContain('Select a configured game server');
    const rows = result.components.map((row) => row.toJSON());
    expect(rows).toHaveLength(2);
    expect(rows[0]?.components[0]?.type).toBe(3);
    const addButton = rows[1]?.components[0] as { label: string; disabled: boolean };
    expect(addButton.label).toBe('Add Server');
    expect(addButton.disabled).toBe(true);
  });

  it('enables Add Server button when a server is selected', () => {
    const result = renderAddGameServersPanel([server], secret, 'channel-1', server.id);
    const rows = result.components.map((row) => row.toJSON());
    const addButton = rows[1]?.components[0] as { label: string; disabled: boolean };
    expect(addButton.label).toBe('Add Server');
    expect(addButton.disabled).toBe(false);
    const selectMenu = rows[0]?.components[0] as { options: { default: boolean }[] };
    expect(selectMenu.options[0]?.default).toBe(true);
  });

  it('disables Add Server and marks option when the selected server already has a card', () => {
    const result = renderAddGameServersPanel(
      [{ ...server, hasCard: true }],
      secret,
      'channel-1',
      server.id,
    );
    const rows = result.components.map((row) => row.toJSON());
    const addButton = rows[1]?.components[0] as { label: string; disabled: boolean };
    expect(addButton.disabled).toBe(true);
    const selectMenu = rows[0]?.components[0] as { options: { description: string }[] };
    expect(selectMenu.options[0]?.description).toBe('Already added');
  });

  it('renders Components V2 server card with required fields', () => {
    const result = renderGameServerCard(server, secret);
    expect(result.flags).toBe(32768);
    expect(result.allowedMentions).toEqual({ parse: [] });
    const container = firstContainer(result);
    expect(container.type).toBe(17);
    const text = textContents(container);
    expect(text).toContain('# 1v1 Arena\n### • Online · Los Angeles\n-# 0/16 players');
    expect(text).toContain(
      'Challenge other players 1v1, warm up, or kill time between matches.\n-# Open to all Office Club members.',
    );
    expect(text).toContain('**Current map**\n`aim_map_office`');
    expect(text).toContain('`arena.example.com:27015`');
    expect(text).not.toContain('Connect Command');
    expect(text).not.toContain('**Host**');
    expect(text).not.toContain('📍');

    const rowButtons = buttons(container);
    expect(rowButtons).toHaveLength(2);
    expect(rowButtons[0]?.label).toBe('Connect');
    expect(rowButtons[0]?.emoji).toEqual({ name: '▶' });
    expect(rowButtons[1]?.label).toBe('Map & Rules');
    expect(rowButtons[1]?.emoji).toEqual({ name: '🗺' });
  });

  it('renders the status summary in the header and map details above the actions', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    const section = components[0] as Record<string, unknown>;
    const header = (section.components as Record<string, unknown>[])[0];
    expect(header?.content).toBe('# 1v1 Arena\n### • Online · Los Angeles\n-# 0/16 players');
    expect(components.map((component) => component.type)).toEqual([
      9, 10, 14, 10, 12, 10, 1, 14, 10, 10, 10, 10, 10,
    ]);
  });

  it('uses blue accent when online', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    expect(container.accentColor).toBe(0x2b8aef);
  });

  it('keeps the blue accent when offline', () => {
    const view = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STOPPED', gameplayState: 'UNAVAILABLE' },
    };
    const container = firstContainer(renderGameServerCard(view, secret));
    expect(container.accentColor).toBe(0x2b8aef);
  });

  it('includes the server identity thumbnail accessory', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components[0]?.type).toBe(9);
    const section = components[0] as Record<string, unknown>;
    const accessory = section.accessory as Record<string, unknown>;
    expect(accessory.type).toBe(11);
    expect((accessory.media as Record<string, unknown>).url).toContain(
      'clickcs-server-thumbnail.png',
    );
  });

  it('renders the resolved map media gallery', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    const gallery = components.find((component) => component.type === 12);
    expect(gallery).toBeDefined();
    const items = (gallery as Record<string, unknown>).items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect((items[0]?.media as Record<string, unknown>).url).toBe(
      resolveMapImageUrl(server.snapshot?.map ?? null, server.imageUrl),
    );
  });

  it('renders signed primary Connect button when join URL is configured', () => {
    const view = { ...server, joinUrl: 'https://example.com/join' };
    const container = firstContainer(renderGameServerCard(view, secret));
    const connectButton = buttons(container)[0];
    expect(connectButton?.style).toBe(1);
    expect(connectButton?.url).toBeUndefined();
    expect(connectButton?.customId).toMatch(/^gs:connect:/);
  });

  it('renders fallback interaction Connect button without join URL', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const connectButton = buttons(container)[0];
    expect(connectButton?.style).toBe(1);
    expect(connectButton?.url).toBeUndefined();
    expect(connectButton?.customId).toMatch(/^gs:connect:/);
  });

  it('renders an unavailable connect command when no address is configured', () => {
    const view = {
      ...server,
      connectDomain: null,
      snapshot: { ...baseSnapshot, host: null, port: null },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('`Unavailable`');
  });

  it('renders distinct online, offline, and starting states', () => {
    const stopped = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STOPPED', gameplayState: 'UNAVAILABLE' },
    };
    expect(textContents(firstContainer(renderGameServerCard(stopped, secret)))).toContain(
      '• Offline',
    );

    const starting = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STARTING', gameplayState: 'UNKNOWN' },
    };
    expect(textContents(firstContainer(renderGameServerCard(starting, secret)))).toContain(
      '• Server starting…',
    );

    const stale = { ...server, snapshot: { ...baseSnapshot, stale: true } };
    expect(textContents(firstContainer(renderGameServerCard(stale, secret)))).toContain(
      '• Status stale',
    );
  });

  it('resolves a dedicated map asset when one exists', () => {
    const url = resolveMapImageUrl('aim_map_office', null, (p) =>
      typeof p === 'string' ? p.includes('aim_map_office') : false,
    );
    expect(url).toContain('aim_map_office');
    expect(url).not.toContain('fallback');
  });

  it('normalizes workshop map identifiers for display', () => {
    const view = {
      ...server,
      snapshot: { ...baseSnapshot, map: 'workshop/3070244462/de_ancient' },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('de_ancient');
    expect(text).not.toContain('workshop');
  });

  it('omits the location suffix when no datacenter is available', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, datacenter: null } };
    const container = firstContainer(renderGameServerCard(view, secret));
    const text = textContents(container);
    expect(text).toContain('# 1v1 Arena\n### • Online\n-# 0/16 players');
    expect(text).not.toContain('📍');
    const section = containerComponents(container)[0] as Record<string, unknown>;
    expect(section.components as Record<string, unknown>[]).toHaveLength(1);
    expect(containerComponents(container).map((component) => component.type)).toEqual([
      9, 10, 14, 10, 12, 10, 1, 14, 10, 10, 10, 10, 10,
    ]);
  });

  it('places content in the approved Components V2 order with consistent native dividers', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components.map((component) => component.type)).toEqual([
      9, 10, 14, 10, 12, 10, 1, 14, 10, 10, 10, 10, 10,
    ]);
    const section = components[0] as Record<string, unknown>;
    expect(section.components as Record<string, unknown>[]).toHaveLength(1);
    expect(components[1]).toEqual({
      type: 10,
      content:
        'Challenge other players 1v1, warm up, or kill time between matches.\n-# Open to all Office Club members.',
    });
    expect(components[2]).toEqual({ type: 14, divider: true, spacing: 1 });
    expect(components[3]).toEqual({
      type: 10,
      content: '**Current map**\n`aim_map_office`',
    });
    expect(components[4]?.type).toBe(12);
    expect(components[5]).toEqual({ type: 10, content: '`arena.example.com:27015`' });
  });

  it('serializes the card with separate update rows and keeps all action behaviors', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const client = new Client({ intents: [] });
    const transform = client.options.jsonTransformer;
    if (transform === undefined) throw new Error('Expected the default Discord JSON transformer');
    const api = transform(container) as APIContainerComponent;
    expect(api.components).toHaveLength(13);
    expect(() => new ContainerBuilder(api).toJSON()).not.toThrow();
    expect(componentCount(container)).toBe(18);
    expect(componentCount(container)).toBeLessThanOrEqual(40);
    expect(
      containerComponents(container).filter(
        (component) => component.type === ComponentType.Separator,
      ),
    ).toEqual([
      { type: 14, divider: true, spacing: 1 },
      { type: 14, divider: true, spacing: 1 },
    ]);
    const row = actionRow(container);
    expect(row.components).toEqual([
      expect.objectContaining({
        label: 'Connect',
        customId: expect.stringMatching(/^gs:connect:/),
      }),
      expect.objectContaining({
        label: 'Map & Rules',
        customId: expect.stringMatching(/^gs:map-rules:/),
      }),
    ]);
  });

  it('keeps the configured max-player suffix and fallback rows readable', () => {
    const view = {
      ...server,
      connectDomain: null,
      snapshot: {
        ...baseSnapshot,
        datacenter: null,
        host: null,
        port: null,
        map: null,
        players: 3,
        maxPlayers: 5,
      },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('### • Online\n-# 3/5 players');
    expect(text).toContain('`Unavailable`');
    expect(text).toContain('**Current map**\n`Unknown`');
  });

  it('normalizes the location once in the header', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, datacenter: 'dallas' } };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text.match(/Dallas/g)).toHaveLength(1);
    expect(text).not.toContain('dallas');
  });

  it.each([null, '', '   '])('uses Unknown for an unresolved map: %s', (map) => {
    expect(displayMapName(map)).toBe('Unknown');
    const view = { ...server, snapshot: { ...baseSnapshot, map } };
    expect(textContents(firstContainer(renderGameServerCard(view, secret)))).toContain('`Unknown`');
  });

  it('normalizes workshop paths and extensions for both display and artwork', () => {
    expect(displayMapName(' workshop/123/aim_map_office.bsp ')).toBe('aim_map_office');
    expect(
      resolveMapImageUrl(
        'workshop/123/aim_map_office.bsp',
        'https://example.com/fallback.jpg',
        () => true,
      ),
    ).toContain('/maps/aim_map_office.webp');
    expect(resolveMapImageUrl('../../private', null, () => true)).toContain('/maps/fallback/');
  });

  it('preserves long values and full occupancy without alignment padding', () => {
    const map = `aim_${'long_map_'.repeat(12)}`;
    const displayName =
      'A long community server name that wraps naturally on narrow Discord clients';
    const connectDomain = `${'long-address-'.repeat(8)}example.com`;
    const view = {
      ...server,
      displayName,
      connectDomain,
      snapshot: { ...baseSnapshot, map, players: 16 },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain(map);
    expect(text).toContain(`# ${displayName}\n`);
    expect(text).toContain(connectDomain);
    expect(text).toContain('-# 16/16 players');
    expect(text).not.toContain('\u00a0');
  });

  it('keeps the fingerprint stable when only observation times change', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, observedAt: new Date() } };
    expect(cardFingerprint(view)).toEqual(cardFingerprint(server));
    expect(cardFingerprint(view).layoutVersion).toBe(19);
  });

  it('resolves card-profile overrides and safely falls back from malformed persisted media', () => {
    const customized = {
      ...server,
      cardProfile: {
        accentColor: '#123456',
        thumbnailImageUrl: 'https://cdn.example.com/thumb.png',
        onlineEmojiId: '12345678901234567',
      },
    };
    const container = firstContainer(renderGameServerCard(customized, secret));
    expect(container.accentColor).toBe(0x123456);
    const header = containerComponents(container)[0] as Record<string, unknown>;
    expect((header.accessory as Record<string, unknown>).media).toEqual({
      url: 'https://cdn.example.com/thumb.png',
    });
    expect(textContents(container)).toContain('<:online_dot:12345678901234567>');
    expect(cardFingerprint(customized)).not.toEqual(cardFingerprint(server));

    const malformed = firstContainer(
      renderGameServerCard(
        { ...server, cardProfile: { thumbnailImageUrl: 'http://bad.example' } },
        secret,
      ),
    );
    const malformedHeader = containerComponents(malformed)[0] as Record<string, unknown>;
    expect((malformedHeader.accessory as Record<string, unknown>).media).toEqual({
      url: expect.stringContaining('clickcs-server-thumbnail.png'),
    });
  });

  it('gives stale telemetry priority over stopped and starting state', () => {
    const text = textContents(
      firstContainer(
        renderGameServerCard(
          { ...server, snapshot: { ...baseSnapshot, hostingState: 'STOPPED', stale: true } },
          secret,
        ),
      ),
    );
    expect(text).toContain('Status stale');
  });

  it('does not render malformed persisted media or detail join URLs', () => {
    expect(
      resolveMapImageUrl('aim_map_office', 'http://unsafe.example/map.jpg', () => false),
    ).not.toContain('unsafe.example');
    const detail = renderGameServerDetail({ ...server, joinUrl: 'not-a-url' });
    expect(detail.components).toEqual([]);
    expect(cardFingerprint({ ...server, joinUrl: 'not-a-url' }).joinUrl).toBeNull();
  });

  it('uses the configured custom status emoji when available', () => {
    vi.stubEnv('GAME_SERVER_EMOJI_ONLINE_ID', '123456789012345678');
    const text = textContents(firstContainer(renderGameServerCard(server, secret)));
    expect(text).toContain('<:online_dot:123456789012345678> Online');
  });

  it('falls back to a text dot when the configured custom status emoji is unavailable', () => {
    const text = textContents(firstContainer(renderGameServerCard(server, secret)));
    expect(text).toContain('### • Online · Los Angeles');
  });

  it('uses a trimmed configured description as the entire description block', () => {
    const view = { ...server, description: '  Custom server details\n-# Members only  ' };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('Custom server details\n-# Members only');
    expect(text).not.toContain('Open to all Office Club members.');
  });

  it('resolves multiple mixed placeholders, suppresses mentions, honors visibility/order and button labels', () => {
    const view = {
      ...server,
      cardProfile: {
        templates: {
          title: '{servername}',
          subtitle: '{online}',
          description: '{playercount} players at {location}; {unknown}',
          playerCount: '{playercount}',
          currentMap: 'Map: {currentmap}',
          serverAddress: 'Join {serveraddress}',
        },
        visibleFields: {
          title: true,
          subtitle: true,
          description: true,
          playerCount: false,
          currentMap: false,
          serverAddress: true,
          updates: false,
        },
        fieldOrder: ['serverAddress', 'description', 'currentMap'],
        buttons: { connect: false, mapRules: false, connectLabel: 'Join', mapRulesLabel: 'Rules' },
      },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('0/16 players at Los Angeles;');
    expect(text).toContain('Join arena.example.com:27015');
    expect(text).not.toContain('{unknown}');
    expect(text).not.toContain('**Current map**');
    expect(text).not.toContain('Latest Updates');
    expect(
      containerComponents(firstContainer(renderGameServerCard(view, secret))).some(
        (item) => item.type === 1,
      ),
    ).toBe(false);
    expect(cardFingerprint(view)).not.toEqual(cardFingerprint(server));
  });

  it('updates configured player templates as cached telemetry changes', () => {
    const view = {
      ...server,
      cardProfile: { templates: { playerCount: '{playercount} players' } },
    };
    const before = cardFingerprint(view);
    const after = cardFingerprint({
      ...view,
      snapshot: { ...baseSnapshot, players: 1, maxPlayers: 5 },
    });
    expect(before).not.toEqual(after);
    expect(textContents(firstContainer(renderGameServerCard(view, secret)))).toContain(
      '0/16 players',
    );
  });

  it('uses the configured per-state status label for status and online placeholders', () => {
    const view = {
      ...server,
      cardProfile: {
        templates: { subtitle: '{status} · {online}' },
        statusLabels: { online: 'Ready' },
      },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('Ready · • Ready');
  });

  it('refreshes the fingerprint when rendered description or map artwork changes', () => {
    expect(cardFingerprint({ ...server, description: 'Custom details' })).not.toEqual(
      cardFingerprint(server),
    );
    expect(cardFingerprint({ ...server, imageUrl: 'https://example.com/map.jpg' })).not.toEqual(
      cardFingerprint(server),
    );
  });

  it('omits unavailable detail metrics instead of rendering N/A', () => {
    const json = renderGameServerDetail(server).embeds[0]?.toJSON();
    expect(JSON.stringify(json)).not.toContain('N/A');
    expect(json?.fields?.find((field) => field.name === 'Network')?.value).toBe(
      'Average ping: 31.0 ms',
    );
    expect(json?.fields?.some((field) => field.name === 'Host')).toBe(false);
  });
});

describe('generic card line rendering', () => {
  it('renders migrated defaults exactly like a legacy card', () => {
    expect(
      renderGameServerCard(
        { ...server, cardProfile: { textLines: resolveCardLines({}), mapArtwork: true } },
        secret,
      ),
    ).toEqual(renderGameServerCard(server, secret));
  });
  it.each(CARD_LINE_IDS)('resolves every placeholder independently in %s', (id) => {
    const template =
      CARD_PLACEHOLDERS.map(([name]) => `{${name}}`).join(' / ') + ' / {severaddress}';
    const lines = resolveCardLines({}).map((line) => ({
      ...line,
      visible: line.id === id,
      style: 'normal' as const,
      template,
    }));
    const profile = { textLines: lines, visibleFields: { updates: false } };
    const content = textContents(
      firstContainer(renderGameServerCard({ ...server, cardProfile: profile }, secret)),
    );
    expect(content).toContain('0/16 / 0 / 16 /');
    expect(content).toContain('Los Angeles / arena.example.com:27015');
    expect(content).toContain('aim_map_office / 1v1 Arena');
    expect(content).not.toMatch(/\{[a-z]+\}/i);
  });
  it('honors array order and each style regardless of ID', () => {
    const styles = ['medium', 'large', 'normal', 'subtext', 'small', 'normal'] as const;
    const lines = resolveCardLines({})
      .reverse()
      .map((line, index) => ({
        ...line,
        template: `Line${String(index)}`,
        style: styles[index] ?? 'normal',
      }));
    const text = textContents(
      firstContainer(
        renderGameServerCard(
          { ...server, cardProfile: { textLines: lines, visibleFields: { updates: false } } },
          secret,
        ),
      ),
    );
    expect(text).toBe('## Line0\n# Line1\nLine2\n-# Line3\n### Line4\nLine5');
    expect(cardFingerprint({ ...server, cardProfile: { textLines: lines } })).not.toEqual(
      cardFingerprint(server),
    );
  });
  it.each([true, false])(
    'keeps artwork and thumbnail independent of empty text (visible=%s)',
    (visible) => {
      const lines = resolveCardLines({}).map((line) => ({ ...line, visible, template: '   ' }));
      const container = firstContainer(
        renderGameServerCard(
          { ...server, cardProfile: { textLines: lines, mapArtwork: true } },
          secret,
        ),
      );
      expect(containerComponents(container)[0]?.type).toBe(9);
      expect(containerComponents(container).some((component) => component.type === 12)).toBe(true);
      const client = new Client({ intents: [] });
      const transform = client.options.jsonTransformer;
      if (transform === undefined) throw new Error('Missing Discord transformer');
      const api = transform(container) as APIContainerComponent;
      expect(() => new ContainerBuilder(api).toJSON()).not.toThrow();
      const noArtwork = firstContainer(
        renderGameServerCard(
          { ...server, cardProfile: { textLines: lines, mapArtwork: false } },
          secret,
        ),
      );
      expect(containerComponents(noArtwork).some((component) => component.type === 12)).toBe(false);
      const inherited = firstContainer(
        renderGameServerCard(
          { ...server, cardProfile: { textLines: lines, visibleFields: { currentMap: false } } },
          secret,
        ),
      );
      expect(containerComponents(inherited).some((component) => component.type === 12)).toBe(false);
    },
  );
  it('styles the first heading once and preserves multiline Markdown', () => {
    expect(styleCardLine('### Existing\n## Embedded\n**Bold**', 'large')).toBe(
      '# Existing\n## Embedded\n**Bold**',
    );
    expect(styleCardLine('-# Existing', 'subtext')).toBe('-# Existing');
    expect(styleCardLine('## Existing', 'normal')).toBe('## Existing');
    expect(styleCardLine('   ', 'large')).toBe('');
    expect(
      resolveCardTemplate(
        '{SERVERNAME} {severaddress}',
        cardPlaceholderValues({ ...server, displayName: '@everyone' }, resolveCardProfile({})),
      ),
    ).toContain('@\u200beveryone');
  });
  it('bounds expanded text and update sections to Discord limits', () => {
    const lines = resolveCardLines({}).map((line) => ({
      ...line,
      template: '{servername}'.repeat(30),
    }));
    const view = {
      ...server,
      displayName: 'x'.repeat(500),
      cardProfile: { textLines: lines },
      updateThreads: [
        {
          type: 'ANNOUNCEMENTS' as const,
          threadId: '123456789012345678',
          latestMessageText: 'update'.repeat(3000),
          latestMessageAt: new Date(),
          notificationExpiresAt: null,
        },
      ],
    };
    const container = firstContainer(renderGameServerCard(view, secret));
    // textContents adds one newline between each display; subtract those separators.
    const contents = containerComponents(container).flatMap((component) =>
      component.type === 9
        ? (component.components as Record<string, unknown>[]).map((child) => String(child.content))
        : component.type === 10
          ? [String(component.content)]
          : [],
    );
    expect(contents.reduce((sum, content) => sum + content.length, 0)).toBeLessThanOrEqual(4000);
    expect(contents.every((content) => content.trim().length > 0)).toBe(true);
    expect(componentCount(container)).toBeLessThanOrEqual(40);
    expect(contents.join('')).toContain('update');
  });
});
