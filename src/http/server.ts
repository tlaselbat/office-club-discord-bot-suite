import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';
import { registerAdminRoutes, type AdminRoutesDependencies } from './routes/admin.js';
import {
  registerMatchZyRoutes,
  type MatchZyRoutesDependencies,
} from '../modules/tenman/http/matchzy.js';

export interface HttpServerDependencies {
  logger: Logger;
  readiness: () => Promise<boolean>;
  matchzy?: MatchZyRoutesDependencies;
  admin?: AdminRoutesDependencies;
}

export async function createHttpServer(dependencies: HttpServerDependencies) {
  const app = Fastify({
    loggerInstance: dependencies.logger as FastifyBaseLogger,
    bodyLimit: 64 * 1024,
    requestIdHeader: false,
    // The app is published only on loopback and is reached through one Caddy
    // proxy hop. Trust that immediate hop so rate limiting uses client IPs.
    trustProxy: (_address, hop) => hop === 0,
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  if (dependencies.admin !== undefined) registerAdminRoutes(app, dependencies.admin);
  if (dependencies.matchzy !== undefined) registerMatchZyRoutes(app, dependencies.matchzy);

  app.get('/health/live', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, () => ({
    status: 'ok',
  }));
  app.get('/health/ready', async (_request, reply) => {
    const ready = await dependencies.readiness();
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable' });
  });

  // Fastify's default not-found message embeds the unredacted request URL.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.warn(
      { err: error, action: 'http_request', result: 'failed' },
      'HTTP request failed',
    );
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const safeStatusCode = statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    void reply.code(safeStatusCode).send({
      error: safeStatusCode < 500 ? 'invalid_request' : 'internal_error',
      requestId: request.id,
    });
  });
  return app;
}
