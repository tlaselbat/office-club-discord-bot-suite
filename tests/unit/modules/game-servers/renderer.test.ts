import { describe, expect, it } from 'vitest';
import {
  renderAddGameServersPanel,
  renderGameServerCard,
  renderGameServerDetail,
  type ServerView,
} from '../../../../src/modules/game-servers/renderer.js';

const server: ServerView = {
  id: '513af1bb-31fa-4b17-bd2e-2ec450984cea',
  providerServerId: 'provider-1',
  displayName: '1v1 Arena',
  description: null,
  enabled: true,
  public: true,
  connectDomain: 'arena.example.com',
  joinUrl: null,
  sortOrder: 0,
  snapshot: {
    hostingState: 'RUNNING',
    gameplayState: 'AVAILABLE',
    host: '192.0.2.1',
    hostname: '1v1 Arena',
    port: 27015,
    datacenter: 'Los Angeles',
    map: null,
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
  },
};

describe('Game Server rendering', () => {
  it('renders Add Game Servers panel with title and Add Server button', () => {
    const result = renderAddGameServersPanel([server], 'secret');
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
    const result = renderAddGameServersPanel([server], 'secret', server.id);
    const rows = result.components.map((row) => row.toJSON());
    const addButton = rows[1]?.components[0] as { label: string; disabled: boolean };
    expect(addButton.label).toBe('Add Server');
    expect(addButton.disabled).toBe(false);
    const selectMenu = rows[0]?.components[0] as { options: { default: boolean }[] };
    expect(selectMenu.options[0]?.default).toBe(true);
  });

  it('renders server card with required fields', () => {
    const json = renderGameServerCard(server).embeds[0]?.toJSON();
    const fieldNames = json?.fields?.map((field) => field.name);
    expect(fieldNames).toContain('Status');
    expect(fieldNames).toContain('Players');
    expect(fieldNames).toContain('Host');
    expect(fieldNames).toContain('Location');
    expect(fieldNames).toContain('Connect');
    expect(json?.fields?.find((field) => field.name === 'Players')?.value).toBe('0 / 16');
    expect(json?.fields?.find((field) => field.name === 'Status')?.value).toBe('Online');
  });

  it('omits unavailable detail metrics instead of rendering N/A', () => {
    const json = renderGameServerDetail(server).embeds[0]?.toJSON();
    expect(JSON.stringify(json)).not.toContain('N/A');
    expect(json?.fields?.find((field) => field.name === 'Network')?.value).toBe(
      'Average ping: 31.0 ms',
    );
    expect(json?.fields?.some((field) => field.name === 'Host')).toBe(false);
  });

  it.each([
    ['STOPPED', 'UNKNOWN', false, 'Server stopped'],
    ['STARTING', 'UNKNOWN', false, 'Server starting'],
    ['RUNNING', 'DEGRADED', false, 'live data unavailable'],
    ['RUNNING', 'AVAILABLE', true, 'Status stale'],
  ])('renders distinct state %s', (hostingState, gameplayState, stale, text) => {
    if (server.snapshot === null) throw new Error('Test snapshot required');
    const view = {
      ...server,
      snapshot: { ...server.snapshot, hostingState, gameplayState, stale },
    };
    const json = renderGameServerCard(view).embeds[0]?.toJSON();
    expect(json?.fields?.find((field) => field.name === 'Status')?.value).toContain(text);
  });
});
