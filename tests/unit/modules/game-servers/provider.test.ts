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

describe('DatHostGameServerProvider', () => {
  it.each([
    [{ on: false, booting: false }, 'STOPPED'],
    [{ on: true, booting: true }, 'STARTING'],
  ])('derives non-running state and skips monitoring', async (server, expected) => {
    const client = reader(server);
    const result = await new DatHostGameServerProvider(client).observe('server-1', undefined, now);
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
    const result = await new DatHostGameServerProvider(client).observe('server-1', undefined, now);
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

  it('reads the current map from server settings', async () => {
    const client = reader(
      { on: true, cs2_settings: { map: 'workshop/3070244462/de_ancient' } },
      { player_ids: { players: [] } },
    );
    const result = await new DatHostGameServerProvider(client).observe('server-1', undefined, now);
    expect(result.map).toBe('workshop/3070244462/de_ancient');
  });

  it('falls back to the lagging server count when monitoring fails', async () => {
    const client = reader({ on: true, players_online: 3 });
    vi.mocked(client.getCsMonitoringMetrics).mockRejectedValue(new Error('outage'));
    const result = await new DatHostGameServerProvider(client).observe('server-1', undefined, now);
    expect(result).toMatchObject({
      hostingState: 'RUNNING',
      gameplayState: 'DEGRADED',
      players: 3,
      playerCountSource: 'DATHOST_SERVER_OBJECT',
      monitoringSource: false,
    });
  });
});
