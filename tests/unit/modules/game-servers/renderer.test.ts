import { describe, expect, it } from 'vitest';
import {
  renderGameServerDetail,
  renderGameServerPanel,
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
  it('does not confuse zero players with offline', () => {
    const json = renderGameServerPanel([server], 'secret').embeds[0]?.toJSON();
    expect(json?.description).toContain('0 / 16 players');
    expect(json?.description).toContain('Online');
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
    expect(renderGameServerPanel([view], 'secret').embeds[0]?.toJSON().description).toContain(text);
  });
});
