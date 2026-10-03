import { describe, expect, it } from 'vitest';
import { Client, ComponentType, ContainerBuilder, type APIContainerComponent } from 'discord.js';
import {
  renderAddGameServersPanel,
  renderGameServerCard,
  renderGameServerDetail,
  resolveMapImageUrl,
  displayMapName,
  cardFingerprint,
  type ServerView,
} from '../../../../src/modules/game-servers/renderer.js';

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
  const row = components[components.length - 1];
  expect(row?.type).toBe(1);
  return row as Record<string, unknown>;
}

function buttons(container: Record<string, unknown>): Record<string, unknown>[] {
  return actionRow(container).components as Record<string, unknown>[];
}

describe('Game Server rendering', () => {
  it('serializes to valid Discord API components through the installed discord.js transformer', () => {
    const client = new Client({ intents: [] });
    const container = firstContainer(renderGameServerCard(server, secret));
    const transform = client.options.jsonTransformer;
    if (transform === undefined) throw new Error('Expected the default Discord JSON transformer');
    const api = transform(container) as APIContainerComponent;
    expect(api.accent_color).toBe(0x23a55a);
    expect(() => new ContainerBuilder(api).toJSON()).not.toThrow();
    const row = api.components.at(-1);
    expect(row?.type).toBe(1);
    if (row?.type === ComponentType.ActionRow) {
      expect(row.components).toHaveLength(2);
      expect(row.components[0]).toHaveProperty('custom_id', expect.stringMatching(/^gs:connect:/));
    }
  });

  it('renders Add Game Servers panel with title and Add Server button', () => {
    const result = renderAddGameServersPanel([server], secret);
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
    const result = renderAddGameServersPanel([server], secret, server.id);
    const rows = result.components.map((row) => row.toJSON());
    const addButton = rows[1]?.components[0] as { label: string; disabled: boolean };
    expect(addButton.label).toBe('Add Server');
    expect(addButton.disabled).toBe(false);
    const selectMenu = rows[0]?.components[0] as { options: { default: boolean }[] };
    expect(selectMenu.options[0]?.default).toBe(true);
  });

  it('disables Add Server and marks option when the selected server already has a card', () => {
    const result = renderAddGameServersPanel([{ ...server, hasCard: true }], secret, server.id);
    const rows = result.components.map((row) => row.toJSON());
    const addButton = rows[1]?.components[0] as { label: string; disabled: boolean };
    expect(addButton.disabled).toBe(true);
    const selectMenu = rows[0]?.components[0] as { options: { description: string }[] };
    expect(selectMenu.options[0]?.description).toBe('Already added');
  });

  it('renders Components V2 server card with required fields', () => {
    const result = renderGameServerCard(server, secret);
    expect(result.flags).toBe(32768);
    const container = firstContainer(result);
    expect(container.type).toBe(17);
    const text = textContents(container);
    expect(text).toContain('# 1v1 Arena');
    expect(text).toContain('🟢 **Online**');
    expect(text).toContain('👥 **0 / 16 players**');
    expect(text).toContain('📍 Los Angeles');
    expect(text).toContain('**Current Map**');
    expect(text).toContain('`aim_map_office`');
    expect(text).not.toContain('**Location**');
    expect(text).toContain('**Host**');
    expect(text).toContain('**Connect**');
    expect(text).toContain('`arena.example.com:27015`');

    const rowButtons = buttons(container);
    expect(rowButtons).toHaveLength(2);
    expect(rowButtons[0]?.label).toBe('Connect');
    expect(rowButtons[0]?.emoji).toEqual({ name: '▶' });
    expect(rowButtons[1]?.label).toBe('Map & Rules');
    expect(rowButtons[1]?.emoji).toEqual({ name: '🗺' });
  });

  it('uses green accent when online', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    expect(container.accentColor).toBe(0x23a55a);
  });

  it('uses red accent when offline', () => {
    const view = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STOPPED', gameplayState: 'UNAVAILABLE' },
    };
    const container = firstContainer(renderGameServerCard(view, secret));
    expect(container.accentColor).toBe(0xed4245);
  });

  it('includes the server identity thumbnail accessory', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components[0]?.type).toBe(9);
    const section = components[0] as Record<string, unknown>;
    const accessory = section.accessory as Record<string, unknown>;
    expect(accessory.type).toBe(11);
    expect((accessory.media as Record<string, unknown>).url).toContain('icon.jpg');
  });

  it('renders the map media gallery with the fallback arena image', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components[3]?.type).toBe(12);
    const gallery = components[3] as Record<string, unknown>;
    const items = gallery.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect((items[0]?.media as Record<string, unknown>).url).toContain('clickcs-arena.jpg');
  });

  it('renders link Connect button when join URL is configured', () => {
    const view = { ...server, joinUrl: 'https://example.com/join' };
    const container = firstContainer(renderGameServerCard(view, secret));
    const connectButton = buttons(container)[0];
    expect(connectButton?.style).toBe(5);
    expect(connectButton?.url).toBe('https://example.com/join');
    expect(connectButton?.customId).toBeUndefined();
  });

  it('renders fallback interaction Connect button without join URL', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const connectButton = buttons(container)[0];
    expect(connectButton?.style).toBe(3);
    expect(connectButton?.url).toBeUndefined();
    expect(connectButton?.customId).toMatch(/^gs:connect:/);
  });

  it('renders distinct online, offline, and starting states', () => {
    const stopped = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STOPPED', gameplayState: 'UNAVAILABLE' },
    };
    expect(textContents(firstContainer(renderGameServerCard(stopped, secret)))).toContain(
      '🔴 **Server stopped**',
    );

    const starting = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STARTING', gameplayState: 'UNKNOWN' },
    };
    expect(textContents(firstContainer(renderGameServerCard(starting, secret)))).toContain(
      '🟡 **Server starting…**',
    );

    const stale = { ...server, snapshot: { ...baseSnapshot, stale: true } };
    expect(textContents(firstContainer(renderGameServerCard(stale, secret)))).toContain(
      '🟡 **Status stale**',
    );
  });

  it('resolves the configured server image URL as map fallback before the default arena image', () => {
    const view = { ...server, imageUrl: 'https://example.com/server-map.png' };
    const container = firstContainer(renderGameServerCard(view, secret));
    const gallery = containerComponents(container)[3] as Record<string, unknown>;
    const items = gallery.items as Record<string, unknown>[];
    expect((items[0]?.media as Record<string, unknown>).url).toBe(
      'https://example.com/server-map.png',
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
    expect(text).toContain('`de_ancient`');
    expect(text).not.toContain('workshop');
  });

  it('omits the location marker when no datacenter is available', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, datacenter: null } };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('🟢 **Online**');
    expect(text).not.toContain('📍');
  });

  it('places compact metadata after a small native divider and before the banner/actions', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components.map((component) => component.type)).toEqual([9, 14, 10, 12, 1]);
    const section = components[0] as Record<string, unknown>;
    expect(section.components as Record<string, unknown>[]).toHaveLength(1);
    expect(components[1]).toEqual({ type: 14, divider: true, spacing: 1 });
    expect(String(components[2]?.content).split('\n')).toEqual([
      '🗺️ **Current Map** `aim_map_office`',
      '🖥️ **Host** 1v1 Arena',
      '🔗 **Connect** `arena.example.com:27015`',
    ]);
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
    const hostname = 'Long Host '.repeat(20).trim();
    const connectDomain = `${'long-address-'.repeat(8)}example.com`;
    const view = {
      ...server,
      connectDomain,
      snapshot: { ...baseSnapshot, map, hostname, players: 16 },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain(map);
    expect(text).toContain(hostname);
    expect(text).toContain(connectDomain);
    expect(text).toContain('16 / 16 players');
    expect(text).not.toContain('\u00a0');
  });

  it('keeps the fingerprint stable when only observation times change', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, observedAt: new Date() } };
    expect(cardFingerprint(view)).toEqual(cardFingerprint(server));
    expect(cardFingerprint(view).layoutVersion).toBe(2);
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
