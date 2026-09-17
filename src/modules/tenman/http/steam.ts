import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SteamOpenId } from '../integrations/steam/openid.js';
import type { SteamLinkService } from '../services/steam-link-service.js';

const tokenParamsSchema = z.object({ token: z.string().min(32).max(128) });
const callbackQuerySchema = z.looseObject({ session: z.string().min(32).max(128) });

export interface SteamRoutesDependencies {
  steamLinkService: SteamLinkService;
  publicBaseUrl: URL;
}

export function registerSteamRoutes(
  app: FastifyInstance,
  dependencies: SteamRoutesDependencies,
): void {
  app.get('/auth/steam/start/:token', async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const session = await dependencies.steamLinkService.getSession(token);
    const steam = new SteamOpenId({
      realm: new URL('/', dependencies.publicBaseUrl).toString(),
      returnUrl: session.expectedReturnUrl,
    });
    return reply.redirect(steam.createAuthenticationUrl().toString());
  });

  app.get('/auth/steam/callback', async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query);
    const session = await dependencies.steamLinkService.getSession(query.session);
    const steam = new SteamOpenId({
      realm: new URL('/', dependencies.publicBaseUrl).toString(),
      returnUrl: session.expectedReturnUrl,
    });
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
      if (typeof value === 'string') parameters.set(key, value);
    }
    const steamId64 = await steam.verify(parameters);
    await dependencies.steamLinkService.complete(query.session, steamId64);
    return reply
      .type('text/html; charset=utf-8')
      .send(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Steam linked</title></head><body><h1>Steam account linked</h1><p>You may return to Discord.</p></body></html>',
      );
  });
}
