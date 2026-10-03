import { describe, expect, it } from 'vitest';
import {
  renderAddGameServersPanel,
  renderGameServerCard,
  renderGameServerDetail,
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

  it('renders Components V2 server card with required fields', () => {
    const result = renderGameServerCard(server, secret);
    expect(result.flags).toBe(32768);
    const container = firstContainer(result);
    expect(container.type).toBe(17);
    const text = textContents(container);
    expect(text).toContain('# 1v1 Arena');
    expect(text).toContain('🟢 Online');
    expect(text).toContain('👥 0 / 16 players');
    expect(text).toContain('`aim_map_office`');
    expect(text).toContain('Los Angeles');
    expect(text).toContain('arena.example.com:27015');

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

  it('renders fallback interaction Connect button without join URL', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const connectButton = buttons(container)[0];
    expect(connectButton?.style).toBe(3);
    expect(connectButton?.url).toBeUndefined();
    expect(connectButton?.customId).toMatch(/^gs:connect:/);
  });

  it('renders link Connect button when join URL is configured', () => {
    const view = { ...server, joinUrl: 'https://example.com/join' };
    const container = firstContainer(renderGameServerCard(view, secret));
    const connectButton = buttons(container)[0];
    expect(connectButton?.style).toBe(5);
    expect(connectButton?.url).toBe('https://example.com/join');
    expect(connectButton?.customId).toBeUndefined();
  });

  it('includes thumbnail when image URL is configured', () => {
    const view = { ...server, imageUrl: 'https://example.com/map.png' };
    const container = firstContainer(renderGameServerCard(view, secret));
    const components = containerComponents(container);
    expect(components).toHaveLength(5);
    const section = components[0];
    expect(section?.type).toBe(9);
    const sectionComponents = (section as Record<string, unknown>).components as Record<
      string,
      unknown
    >[];
    expect(sectionComponents).toHaveLength(3);
    const accessory = (section as Record<string, unknown>).accessory as Record<string, unknown>;
    expect(accessory.type).toBe(11);
    expect((accessory.media as Record<string, unknown>).url).toBe('https://example.com/map.png');
  });

  it('renders text displays directly in container when no image URL is configured', () => {
    const container = firstContainer(renderGameServerCard(server, secret));
    const components = containerComponents(container);
    expect(components).toHaveLength(7);
    expect(components[0]?.type).toBe(10);
    expect(components[5]?.type).toBe(10);
    expect(components[6]?.type).toBe(1);
  });

  it('renders distinct online, offline, and starting states', () => {
    const stopped = {
      ...server,
      snapshot: { ...baseSnapshot, hostingState: 'STOPPED', gameplayState: 'UNAVAILABLE' },
    };
    expect(textContents(firstContainer(renderGameServerCard(stopped, secret)))).toContain(
      '🔴 Server stopped',
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

  it('omits unavailable detail metrics instead of rendering N/A', () => {
    const json = renderGameServerDetail(server).embeds[0]?.toJSON();
    expect(JSON.stringify(json)).not.toContain('N/A');
    expect(json?.fields?.find((field) => field.name === 'Network')?.value).toBe(
      'Average ping: 31.0 ms',
    );
    expect(json?.fields?.some((field) => field.name === 'Host')).toBe(false);
  });
});
