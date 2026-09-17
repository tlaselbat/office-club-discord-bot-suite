import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpServer } from '../../src/http/server.js';
import type { AdminRoutesDependencies } from '../../src/http/routes/admin.js';
import { sessionCookieName } from '../../src/http/admin/security.js';

const servers: Awaited<ReturnType<typeof createHttpServer>>[] = [];
afterEach(async () => Promise.all(servers.map(async (server) => server.close())));

function adminDependencies(): AdminRoutesDependencies {
  return {
    prisma: { tenManSettings: { findMany: vi.fn() } },
    discord: { isReady: () => true, guilds: { cache: new Map() } },
    settings: {},
    resources: {},
    diagnostics: {},
    sessions: { resolve: vi.fn().mockResolvedValue(null) },
    publicBaseUrl: new URL('https://10man.example.com'),
    clientId: '12345678901234567',
    clientSecret: 'client-secret',
    ownerIds: ['12345678901234567'],
    sessionSecret: 's'.repeat(32),
  } as unknown as AdminRoutesDependencies;
}

describe('owner panel', () => {
  it('redirects anonymous users and prevents indexing', async () => {
    const server = await createHttpServer({
      logger: pino({ enabled: false }),
      readiness: () => Promise.resolve(true),
      admin: adminDependencies(),
    });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/admin/login');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('rejects authenticated reward mutations with an invalid CSRF token', async () => {
    const dependencies = adminDependencies();
    dependencies.sessions.resolve = vi.fn().mockResolvedValue({
      discordUserId: '12345678901234567',
    });
    const server = await createHttpServer({
      logger: pino({ enabled: false }),
      readiness: () => Promise.resolve(true),
      admin: dependencies,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/admin/guilds/22345678901234567/rewards/adjust',
      headers: { cookie: `${sessionCookieName}=session-token` },
      payload: {
        csrf: 'invalid',
        discordUserId: '32345678901234567',
        amount: '10',
        reason: 'Recognition',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('starts Discord OAuth with identify scope and a secure state cookie', async () => {
    const server = await createHttpServer({
      logger: pino({ enabled: false }),
      readiness: () => Promise.resolve(true),
      admin: adminDependencies(),
    });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/admin/login' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('scope=identify');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
