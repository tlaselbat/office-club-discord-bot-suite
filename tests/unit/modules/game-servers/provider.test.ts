import { describe, expect, it, vi } from 'vitest';
import type { DatHostServerReader } from '../../../../src/integrations/dathost/client.js';
import { DatHostGameServerProvider } from '../../../../src/modules/game-servers/provider.js';

const now = new Date('2026-10-03T00:00:00.000Z');

function reader(server: Record<string, unknown>, metrics: unknown = {}): DatHostServerReader {
  return {
    listServers: vi.fn(),
    getServer: vi.fn().mockResolvedValue({
      id: 'server-1',
      name: 'Arena',
      created_at: 1,
      booting: false,
      ...server,
    }),
    getServerMetrics: vi.fn(),
    getCsMonitoringOverview: vi.fn(),
    getCsMonitoringMetrics: vi.fn().mockResolvedValue(metrics),
  } as unknown as DatHostServerReader;
}

function provider(
  client: DatHostServerReader,
  queryCurrentMap = vi.fn().mockRejectedValue(new Error('A2S unavailable')),
): DatHostGameServerProvider {
  return new DatHostGameServerProvider(client, queryCurrentMap);
}

describe('DatHostGameServerProvider', () => {
  it.each([
    [{ on: false, booting: false }, 'STOPPED'],
    [{ on: true, booting: true }, 'STARTING'],
  ])('derives non-running state and skips monitoring', async (server, expected) => {
    const client = reader(server);
    const result = await provider(client).observe('server-1', undefined, now);
    expect(result.hostingState).toBe(expected);
    expect(client.getCsMonitoringMetrics).not.toHaveBeenCalled();
  });

  it('uses newest samples, averages players, and treats zero connected players as online', async () => {
    const client = reader(
      {
        on: true,
        players_online: 9,
        ip: '192.0.2.1',
        ports: { game: 27015 },
        cs2_settings: { slots: 16 },
      },
      {
        cpu_memory: {
          cpu: [
            ['2026-10-02T23:59:00.000Z', 10],
            ['2026-10-03T00:00:00.000Z', 25],
          ],
          memory_mb: [['2026-10-03T00:00:00.000Z', 2048]],
        },
        player_ping: {
          series: [
            { values: [['2026-10-03T00:00:00.000Z', 20]] },
            { values: [['2026-10-03T00:00:00.000Z', 40]] },
          ],
        },
        player_ids: { players: [] },
      },
    );
    const result = await provider(client).observe('server-1', undefined, now);
    expect(result).toMatchObject({
      hostingState: 'RUNNING',
      gameplayState: 'AVAILABLE',
      players: 0,
      maxPlayers: 16,
      playerCountSource: 'DATHOST_MONITORING',
      cpuPercent: 25,
      memoryUsageMb: 2048,
      averagePingMs: 30,
    });
  });

  it('uses the live A2S map instead of configured DatHost map settings', async () => {
    const client = reader(
      {
        on: true,
        raw_ip: '198.51.100.20',
        ip: 'provider.example.invalid',
        custom_domain: 'players.example.invalid',
        ports: { game: 26805 },
        cs2_settings: { map: 'de_dust2' },
      },
      { player_ids: { players: [] } },
    );
    const queryCurrentMap = vi.fn().mockResolvedValue('workshop/3070244462/de_ancient');
    const result = await provider(client, queryCurrentMap).observe('server-1', undefined, now);
    expect(result.map).toBe('workshop/3070244462/de_ancient');
    expect(queryCurrentMap).toHaveBeenCalledWith('198.51.100.20', 26805);
  });

  it('falls back to the lagging server count when monitoring fails', async () => {
    const client = reader({
      on: true,
      players_online: 3,
      raw_ip: '198.51.100.20',
      ports: { game: 26805 },
    });
    vi.mocked(client.getCsMonitoringMetrics).mockRejectedValue(new Error('outage'));
    const result = await provider(client, vi.fn().mockResolvedValue('am_water_wf')).observe(
      'server-1',
      undefined,
      now,
    );
    expect(result).toMatchObject({
      map: 'am_water_wf',
      hostingState: 'RUNNING',
      gameplayState: 'DEGRADED',
      players: 3,
      playerCountSource: 'DATHOST_SERVER_OBJECT',
      monitoringSource: false,
    });
  });

  it('keeps the map unknown when A2S fails without making the observation fail', async () => {
    const client = reader(
      {
        on: true,
        raw_ip: '198.51.100.20',
        ports: { game: 26805 },
        cs2_settings: { map: 'de_mirage' },
      },
      { player_ids: { players: [] } },
    );
    const result = await provider(client).observe('server-1', undefined, now);
    expect(result).toMatchObject({ map: null, gameplayState: 'AVAILABLE' });
  });

  it('does not query non-running servers or non-IP endpoints', async () => {
    const stopped = reader({ on: false, raw_ip: '198.51.100.20', ports: { game: 26805 } });
    const stoppedQuery = vi.fn();
    await provider(stopped, stoppedQuery).observe('server-1', undefined, now);
    expect(stoppedQuery).not.toHaveBeenCalled();

    const noRawIp = reader({
      on: true,
      raw_ip: undefined,
      ip: 'server.example.invalid',
      ports: { game: 26805 },
    });
    const invalidEndpointQuery = vi.fn();
    await provider(noRawIp, invalidEndpointQuery).observe('server-1', undefined, now);
    expect(invalidEndpointQuery).not.toHaveBeenCalled();
  });
});
