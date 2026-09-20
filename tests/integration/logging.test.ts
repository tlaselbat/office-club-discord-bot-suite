import { describe, expect, it } from 'vitest';
import { createHttpServer } from '../../src/http/server.js';
import { createLogger } from '../../src/logging/logger.js';

describe('production request logging', () => {
  it('starts with the production redaction configuration and removes token fields', () => {
    let output = '';
    const logger = createLogger('info', {
      write: (chunk) => {
        output += chunk;
      },
    });
    logger.info({
      token: 'secret-token',
      authorization: 'secret-auth',
      child: { token: 'nested-token' },
    });
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('secret-auth');
    expect(output).not.toContain('nested-token');
    expect(output).toContain('[REDACTED]');
  });

  it('does not log authentication paths, callback queries, or headers, including unknown routes', async () => {
    let output = '';
    const logger = createLogger('info', {
      write: (chunk) => {
        output += chunk;
      },
    });
    const app = await createHttpServer({ logger, readiness: async () => true });
    app.get('/admin/auth/callback', () => ({ status: 'ok' }));
    app.get('/auth/steam/start/:token', () => ({ status: 'ok' }));
    try {
      for (const url of [
        '/admin/auth/callback?code=oauth-sentinel&state=state-sentinel',
        '/auth/steam/start/steam-sentinel',
        '/auth/steam/start/unknown-sentinel/extra?session=session-sentinel',
      ]) {
        await app.inject({
          url,
          headers: {
            authorization: 'authorization-sentinel',
            'x-matchzy-token': 'matchzy-sentinel',
            cookie: '__Secure-tenman_admin=cookie-sentinel',
          },
        });
      }
      expect(output).not.toContain('-sentinel');
      expect(output).toContain('/admin/auth/callback');
      expect(output).toContain('/auth/steam/start/[REDACTED]');
      expect(output).toContain('request completed');
    } finally {
      await app.close();
    }
  });

  it('uses the one trusted Caddy proxy hop for client identity', async () => {
    const app = await createHttpServer({
      logger: createLogger('silent'),
      readiness: async () => true,
    });
    app.get('/client-ip', (request) => ({ ip: request.ip }));
    try {
      const response = await app.inject({
        url: '/client-ip',
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': '198.51.100.24' },
      });
      expect(response.json()).toEqual({ ip: '198.51.100.24' });
    } finally {
      await app.close();
    }
  });
});
