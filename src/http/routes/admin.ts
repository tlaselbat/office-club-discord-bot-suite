import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DiscordOAuthClient } from '../admin/discord-oauth.js';
import {
  createOAuthState,
  sessionCookieName,
  stateCookieName,
  verifyOAuthState,
} from '../admin/security.js';
import {
  generalPage,
  guildIndex,
  loginPage,
  page,
  panelCss,
  panelScript,
  type GeneralPageModel,
} from '../admin/views.js';
import { registerCompetitiveRoutes } from './admin/competitive.js';
import { registerGameServersRoutes } from './admin/game-servers.js';
import { registerRewardsRoutes } from './admin/rewards.js';
import { registerAuditRoutes } from './admin/audit.js';
import { createSharedHelpers, idSchema, type AdminRoutesDependencies } from './admin/shared.js';

export type { AdminRoutesDependencies } from './admin/shared.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRoutesDependencies,
): void {
  const callbackUrl = new URL('/admin/auth/callback', dependencies.publicBaseUrl).toString();
  const oauth = new DiscordOAuthClient(
    dependencies.clientId,
    dependencies.clientSecret,
    callbackUrl,
  );
  const ownerIds = new Set(dependencies.ownerIds);
  const secureCookie = { secure: true, httpOnly: true, sameSite: 'lax' as const, path: '/admin' };
  const shared = createSharedHelpers(dependencies);

  app.get('/admin/assets/panel.css', (_request, reply) =>
    reply.header('cache-control', 'public, max-age=3600').type('text/css').send(panelCss),
  );
  app.get('/admin/assets/panel.js', (_request, reply) =>
    reply.header('cache-control', 'public, max-age=3600').type('text/javascript').send(panelScript),
  );

  app.get('/admin/login', async (_request, reply) => {
    shared.headers(reply);
    const state = createOAuthState(dependencies.sessionSecret);
    reply.setCookie(stateCookieName, state, {
      ...secureCookie,
      path: '/admin/auth/callback',
      maxAge: 600,
    });
    return reply.type('text/html').send(loginPage(oauth.authorizationUrl(state)));
  });

  app.get('/admin/auth/callback', async (request, reply) => {
    shared.headers(reply);
    const parsed = z
      .object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(512) })
      .safeParse(request.query);
    const cookieState = request.cookies[stateCookieName];
    reply.clearCookie(stateCookieName, { ...secureCookie, path: '/admin/auth/callback' });
    if (
      !parsed.success ||
      cookieState === undefined ||
      parsed.data.state !== cookieState ||
      !verifyOAuthState(dependencies.sessionSecret, cookieState)
    )
      return reply
        .code(400)
        .type('text/html')
        .send(
          page(
            'Invalid sign in',
            '<h1>Invalid sign in</h1><p>Start the sign-in process again.</p>',
          ),
        );
    const identity = await oauth.identify(parsed.data.code);
    if (!ownerIds.has(identity.id))
      return reply.code(403).type('text/html').send(page('Forbidden', '<h1>Access denied</h1>'));
    await dependencies.sessions.deleteExpired();
    const token = await dependencies.sessions.create(identity.id);
    reply.setCookie(sessionCookieName, token, { ...secureCookie, maxAge: 8 * 60 * 60 });
    return reply.redirect('/admin');
  });

  app.post('/admin/logout', async (request, reply) => {
    shared.headers(reply);
    const auth = await shared.authenticatePost(request, reply);
    if (auth === null) return;
    await dependencies.sessions.revoke(auth.token);
    reply.clearCookie(sessionCookieName, secureCookie);
    return reply.redirect('/admin/login', 303);
  });

  app.get('/admin', async (request, reply) => {
    shared.headers(reply);
    const auth = await shared.authenticate(request, reply);
    if (auth === null) return;
    if (!dependencies.discord.isReady())
      return reply
        .code(503)
        .type('text/html')
        .send(page('Unavailable', '<h1>Discord is reconnecting</h1><p>Try again shortly.</p>'));
    const guilds = [...dependencies.discord.guilds.cache.values()]
      .map((guild) => ({ id: guild.id, name: guild.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const summaries = await Promise.all(
      guilds.map(async (guild) => ({
        ...guild,
        modules: Object.values(await shared.buildModuleSummaries(guild.id)),
      })),
    );
    return reply.type('text/html').send(guildIndex(auth.discordUserId, auth.csrf, summaries));
  });

  app.get('/admin/guilds/:guildId', async (request, reply) => {
    shared.headers(reply);
    const auth = await shared.authenticate(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    if (!params.success)
      return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
    const discordGuild = dependencies.discord.guilds.cache.get(params.data.guildId);
    if (discordGuild === undefined)
      return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
    const modules = await shared.buildModuleSummaries(params.data.guildId);
    const audit = await shared.recentAudit(params.data.guildId, 10);
    const moduleCards = Object.values(modules).map((module) => ({
      ...module,
      href: `/admin/guilds/${params.data.guildId}/${module.key}`,
      primaryAction:
        module.key === 'game-servers'
          ? {
              label: module.operational === 'Enabled' ? 'Manage' : 'Configure',
              href: `/admin/guilds/${params.data.guildId}/game-servers`,
            }
          : undefined,
      configured: module.configured,
      enabled: module.enabled,
      version: module.version,
    }));
    const model: GeneralPageModel = {
      id: params.data.guildId,
      name: discordGuild.name,
      username: auth.discordUserId,
      csrf: auth.csrf,
      discordAvailable: dependencies.discord.isReady(),
      modules: moduleCards,
      recentAudit: audit,
    };
    return reply.type('text/html').send(generalPage(model));
  });

  registerCompetitiveRoutes(app, shared);
  registerRewardsRoutes(app, shared);
  registerGameServersRoutes(app, shared);
  registerAuditRoutes(app, shared);
}
