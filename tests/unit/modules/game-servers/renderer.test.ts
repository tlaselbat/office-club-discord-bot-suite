import { describe, expect, it } from 'vitest';
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
    const row = api.components.at(-1);
    expect(row?.type).toBe(1);
    if (row?.type === ComponentType.ActionRow) {
      expect(row.components).toHaveLength(3);
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
    expect(text).toContain(
      '# 1v1 Arena • 🟢 Online\n🔗 arena.example.com:27015\nChallenge other players 1v1, warm up your aim, or kill time during long matchmaking queues. Open to all Office Club members.',
    );
    expect(text).toContain('Los Angeles');
    expect(text).toContain(
      'Challenge other players 1v1, warm up your aim, or kill time during long matchmaking queues. Open to all Office Club members.',
    );
    expect(text).toContain('🗺️ aim_map_office');
    expect(text).not.toContain('Current Map');
    expect(text).toContain('👥 0 / 16 Players');
    expect(text).toContain('🔗 arena.example.com:27015');
    expect(text).not.toContain('Connect Command');
    expect(text).not.toContain('**Host**');
    expect(text).not.toContain('📍');

    const rowButtons = buttons(container);
    expect(rowButtons).toHaveLength(3);
    expect(rowButtons[0]?.label).toBe('Connect');
    expect(rowButtons[0]?.emoji).toEqual({ name: '▶' });
    expect(rowButtons[1]?.label).toBe('Map & Rules');
    expect(rowButtons[1]?.emoji).toEqual({ name: '🗺' });
    expect(rowButtons[2]?.label).toBe('Copy Address');
    expect(rowButtons[2]?.emoji).toEqual({ name: '📋' });
  });

  it('places status and address in the header and banner above the actions', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    const section = components[0] as Record<string, unknown>;
    const header = (section.components as Record<string, unknown>[])[0];
    expect(header?.content).toBe(
      '# 1v1 Arena • 🟢 Online\n🔗 arena.example.com:27015\nChallenge other players 1v1, warm up your aim, or kill time during long matchmaking queues. Open to all Office Club members.',
    );
    expect(components.map((component) => component.type)).toEqual([
      9, 14, 10, 10, 10, 14, 12, 14, 1,
    ]);
  });

  it('uses blue accent when online', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    expect(container.accentColor).toBe(0x2b8aef);
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
    expect((accessory.media as Record<string, unknown>).url).toContain(
      'clickcs-server-thumbnail.png',
    );
  });

  it('renders the server banner media gallery', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    const gallery = components.find((component) => component.type === 12);
    expect(gallery).toBeDefined();
    const items = (gallery as Record<string, unknown>).items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect((items[0]?.media as Record<string, unknown>).url).toContain('clickcs-server-banner.png');
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
    expect(connectButton?.style).toBe(1);
    expect(connectButton?.url).toBeUndefined();
    expect(connectButton?.customId).toMatch(/^gs:connect:/);
  });

  it('renders a Copy Address button with a signed custom ID', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const copyButton = buttons(container)[2];
    expect(copyButton?.label).toBe('Copy Address');
    expect(copyButton?.emoji).toEqual({ name: '📋' });
    expect(copyButton?.style).toBe(2);
    expect(copyButton?.customId).toMatch(/^gs:copy-address:/);
  });

  it('renders an unavailable connect command when no address is configured', () => {
    const view = {
      ...server,
      connectDomain: null,
      snapshot: { ...baseSnapshot, host: null, port: null },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain('🔗 Unavailable');
    expect(text).not.toContain('`Unavailable`');
  });

  it('renders distinct online, offline, and starting states', () => {
    const stopped = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STOPPED', gameplayState: 'UNAVAILABLE' },
    };
    expect(textContents(firstContainer(renderGameServerCard(stopped, secret)))).toContain(
      '🔴 Offline',
    );

    const starting = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STARTING', gameplayState: 'UNKNOWN' },
    };
    expect(textContents(firstContainer(renderGameServerCard(starting, secret)))).toContain(
      '🟡 Server starting…',
    );

    const stale = { ...server, snapshot: { ...baseSnapshot, stale: true } };
    expect(textContents(firstContainer(renderGameServerCard(stale, secret)))).toContain(
      '🟡 Status stale',
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
    expect(text).not.toContain('`de_ancient`');
    expect(text).not.toContain('workshop');
  });

  it('omits the location marker when no datacenter is available', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, datacenter: null } };
    const container = firstContainer(renderGameServerCard(view, secret));
    const text = textContents(container);
    expect(text).toContain(
      '# 1v1 Arena • 🟢 Online\n🔗 arena.example.com:27015\nChallenge other players 1v1, warm up your aim, or kill time during long matchmaking queues. Open to all Office Club members.',
    );
    expect(text).not.toContain('📍');
    const section = containerComponents(container)[0] as Record<string, unknown>;
    expect(section.components as Record<string, unknown>[]).toHaveLength(1);
    expect(containerComponents(container).map((component) => component.type)).toEqual([
      9, 14, 10, 10, 14, 12, 14, 1,
    ]);
  });

  it('places content in the approved Components V2 order with consistent native dividers', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components.map((component) => component.type)).toEqual([
      9, 14, 10, 10, 10, 14, 12, 14, 1,
    ]);
    const section = components[0] as Record<string, unknown>;
    expect(section.components as Record<string, unknown>[]).toHaveLength(1);
    expect(components[1]).toEqual({ type: 14, divider: true, spacing: 1 });
    expect(components[2]).toEqual({
      type: 10,
      content: 'Los Angeles',
    });
    expect(components[3]).toEqual({
      type: 10,
      content: '🗺️ aim_map_office',
    });
    expect(components[4]).toEqual({ type: 10, content: '👥 0 / 16 Players' });
    expect(components[5]).toEqual({ type: 14, divider: true, spacing: 1 });
    expect(components[6]?.type).toBe(12);
    expect(components[7]).toEqual({ type: 14, divider: true, spacing: 1 });
  });

  it('serializes the revised nine-child card and keeps all action behaviors', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const client = new Client({ intents: [] });
    const transform = client.options.jsonTransformer;
    if (transform === undefined) throw new Error('Expected the default Discord JSON transformer');
    const api = transform(container) as APIContainerComponent;
    expect(api.components).toHaveLength(9);
    expect(() => new ContainerBuilder(api).toJSON()).not.toThrow();
    expect(componentCount(container)).toBe(15);
    expect(componentCount(container)).toBeLessThanOrEqual(40);
    expect(
      containerComponents(container).filter(
        (component) => component.type === ComponentType.Separator,
      ),
    ).toEqual(Array.from({ length: 3 }, () => ({ type: 14, divider: true, spacing: 1 })));
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
      expect.objectContaining({
        label: 'Copy Address',
        customId: expect.stringMatching(/^gs:copy-address:/),
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
    expect(text).toContain('🟢 Online');
    expect(text).not.toContain('  •  ');
    expect(text).toContain('🔗 Unavailable');
    expect(text).toContain('🗺️ Unknown');
    expect(text).toContain('👥 3 / 5 Players');
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
    expect(textContents(firstContainer(renderGameServerCard(view, secret)))).toContain(
      '🗺️ Unknown',
    );
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
    const connectDomain = `${'long-address-'.repeat(8)}example.com`;
    const view = {
      ...server,
      connectDomain,
      snapshot: { ...baseSnapshot, map, players: 16 },
    };
    const text = textContents(firstContainer(renderGameServerCard(view, secret)));
    expect(text).toContain(map);
    expect(text).toContain(connectDomain);
    expect(text).toContain('👥 16 / 16 Players');
    expect(text).not.toContain('\u00a0');
  });

  it('keeps the fingerprint stable when only observation times change', () => {
    const view = { ...server, snapshot: { ...baseSnapshot, observedAt: new Date() } };
    expect(cardFingerprint(view)).toEqual(cardFingerprint(server));
    expect(cardFingerprint(view).layoutVersion).toBe(9);
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
