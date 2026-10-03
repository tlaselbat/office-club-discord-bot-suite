import { describe, expect, it, vi } from 'vitest';
import { DatHostClient } from '../../../src/integrations/dathost/client.js';

const server = { id: 'server-1', name: 'Arena', created_at: 1, booting: false };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestedUrl(request: ReturnType<typeof vi.fn<typeof fetch>>, index: number): URL {
  const input = request.mock.calls[index]?.[0];
  if (!(input instanceof URL)) throw new Error('Expected a URL request');
  return input;
}

describe('DatHostClient monitoring', () => {
  it('uses the individual endpoint and maps a missing server to null', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, 404));
    const client = new DatHostClient({
      email: 'bot@example.com',
      password: 'secret',
      baseUrl: 'https://example.test/api/0.1/',
      fetch: request,
    });
    await expect(client.getServer('a/b')).resolves.toBeNull();
    expect(requestedUrl(request, 0).href).toBe('https://example.test/api/0.1/game-servers/a%2Fb');
  });

  it('parses loose server fields and typed monitoring tuples', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...server, unknown: true }))
      .mockResolvedValueOnce(
        response({
          cpu_memory: { cpu: [['2026-10-03T00:00:00.000Z', 20]] },
          player_ids: { players: [] },
          future_field: true,
        }),
      );
    const client = new DatHostClient({
      email: 'bot@example.com',
      password: 'secret',
      baseUrl: 'https://example.test/api/0.1/',
      fetch: request,
    });
    await expect(client.getServer('server-1')).resolves.toMatchObject(server);
    await expect(
      client.getCsMonitoringMetrics(
        'server-1',
        new Date('2026-10-02T23:58:00.000Z'),
        new Date('2026-10-03T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ cpu_memory: { cpu: [['2026-10-03T00:00:00.000Z', 20]] } });
    const url = requestedUrl(request, 1);
    expect(url.pathname).toBe('/api/0.1/cs-monitoring/server/server-1/metrics');
    expect(url.searchParams.get('start_time')).toBe('2026-10-02T23:58:00.000Z');
  });

  it('rejects invalid ranges and malformed telemetry', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ cpu_memory: { cpu: [['bad', 2]] } }));
    const client = new DatHostClient({
      email: 'bot@example.com',
      password: 'secret',
      fetch: request,
    });
    expect(() =>
      client.getCsMonitoringMetrics('server-1', new Date(0), new Date(4 * 60 * 60 * 1000)),
    ).toThrow('at most three hours');
    await expect(
      client.getCsMonitoringMetrics('server-1', new Date(0), new Date(60_000)),
    ).rejects.toThrow();
  });
});
