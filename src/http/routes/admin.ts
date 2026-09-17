import { randomUUID } from 'node:crypto';
import { ChannelType, type Client } from 'discord.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { DiagnosticsService } from '../../modules/tenman/services/diagnostics-service.js';
import type { GuildResourceService } from '../../modules/tenman/services/guild-resource-service.js';
import type { GuildSettingsService } from '../../modules/tenman/services/guild-settings-service.js';
import type { WebSessionService } from '../../services/web-session-service.js';
import { DiscordOAuthClient } from '../admin/discord-oauth.js';
import {
  createOAuthState,
  csrfToken,
  sessionCookieName,
  stateCookieName,
  verifyCsrf,
  verifyOAuthState,
} from '../admin/security.js';
import { guildIndex, guildPage, loginPage, page, panelCss, rewardsPage } from '../admin/views.js';
import {
  RewardSettingsService,
  type RewardLevelInput,
} from '../../modules/rewards/services/reward-settings-service.js';
import { RewardService } from '../../modules/rewards/services/reward-service.js';
import { RewardDiagnosticsService } from '../../modules/rewards/services/reward-diagnostics-service.js';

const idSchema = z.string().regex(/^\d{17,20}$/);
const querySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(512),
});
const csrfSchema = z.object({ csrf: z.string().min(1).max(128) });
const stringArray = z.preprocess(
  (value: unknown): unknown =>
    Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
  z.array(idSchema).min(1).max(25),
);
const optionalIdArray = z.preprocess(
  (value: unknown): unknown =>
    Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
  z.array(idSchema).max(100),
);
const formStringArray = z.preprocess(
  (value: unknown): unknown =>
    Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
  z.array(z.string().max(128)).max(25),
);
const rewardSettingsSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.union([z.literal('new'), z.coerce.number().int().nonnegative()]),
    textXpAmount: z.coerce.number().int().min(1).max(100000),
    textCooldownSeconds: z.coerce.number().int().min(1).max(86400),
    voiceXpAmount: z.coerce.number().int().min(1).max(100000),
    voiceIntervalSeconds: z.coerce.number().int().min(60).max(86400),
    textChannelIds: optionalIdArray,
    voiceChannelIds: optionalIdArray,
    tagRequiredSeconds: z.coerce.number().int().min(60).max(31536000),
    tagRewardRoleId: z.union([idSchema, z.literal('')]).optional(),
    tagReconcileSeconds: z.coerce.number().int().min(60).max(86400),
    levelNumbers: formStringArray,
    levelThresholds: formStringArray,
    levelLabels: formStringArray,
    levelRoleIds: formStringArray,
  })
  .strict();
const rewardToggleSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.coerce.number().int().nonnegative(),
  })
  .strict();
const rewardAdjustmentSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    adjustmentId: z.uuid(),
    discordUserId: idSchema,
    amount: z.coerce
      .number()
      .int()
      .min(-1000000)
      .max(1000000)
      .refine((value) => value !== 0),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const settingsSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.union([z.literal('new'), z.coerce.number().int().nonnegative()]),
    lobbyTextChannelId: idSchema,
    lobbyVoiceChannelId: idSchema,
    team1VoiceChannelId: idSchema,
    team2VoiceChannelId: idSchema,
    privilegedRoleIds: stringArray,
    moderatorRoleIds: stringArray,
    administratorRoleIds: stringArray,
    dathostTemplateServerId: z.string().min(1).max(128),
    defaultServerLocation: z.string().max(64).optional(),
    defaultGameProfileKey: z.string().min(1).max(64),
  })
  .strict();

export interface AdminRoutesDependencies {
  prisma: PrismaClient;
  discord: Client;
  settings: GuildSettingsService;
  resources: GuildResourceService;
  diagnostics: DiagnosticsService;
  sessions: WebSessionService;
  publicBaseUrl: URL;
  clientId: string;
  clientSecret: string;
  ownerIds: readonly string[];
  sessionSecret: string;
}

interface Authenticated {
  token: string;
  discordUserId: string;
  csrf: string;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRoutesDependencies,
): void {
  const callbackUrl = new URL('/admin/auth/callback', dependencies.publicBaseUrl).toString();
  const rewardSettings = new RewardSettingsService(dependencies.prisma, dependencies.discord);
  const rewards = new RewardService(dependencies.prisma);
  const rewardDiagnostics = new RewardDiagnosticsService(dependencies.prisma, dependencies.discord);
  const oauth = new DiscordOAuthClient(
    dependencies.clientId,
    dependencies.clientSecret,
    callbackUrl,
  );
  const ownerIds = new Set(dependencies.ownerIds);
  const secureCookie = { secure: true, httpOnly: true, sameSite: 'lax' as const, path: '/admin' };
  const headers = (reply: FastifyReply) =>
    reply.headers({
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy':
        "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Authenticated | null> => {
    const token = request.cookies[sessionCookieName];
    if (token === undefined) {
      await reply.redirect('/admin/login');
      return null;
    }
    const identity = await dependencies.sessions.resolve(token);
    if (identity === null || !ownerIds.has(identity.discordUserId)) {
      reply.clearCookie(sessionCookieName, secureCookie);
      await reply.redirect('/admin/login');
      return null;
    }
    return {
      token,
      discordUserId: identity.discordUserId,
      csrf: csrfToken(dependencies.sessionSecret, token),
    };
  };
  const authenticatePost = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Authenticated | null> => {
    const auth = await authenticate(request, reply);
    if (auth === null) return null;
    const parsed = csrfSchema.safeParse(request.body);
    if (!parsed.success || !verifyCsrf(dependencies.sessionSecret, auth.token, parsed.data.csrf)) {
      await reply
        .code(403)
        .type('text/html')
        .send(page('Forbidden', '<h1>Forbidden</h1><p>The form expired or was invalid.</p>'));
      return null;
    }
    return auth;
  };
  const guild = (guildId: string) => dependencies.discord.guilds.cache.get(guildId);

  app.get('/admin/assets/panel.css', (_request, reply) =>
    reply.header('cache-control', 'public, max-age=3600').type('text/css').send(panelCss),
  );
  app.get('/admin/login', async (_request, reply) => {
    headers(reply);
    const state = createOAuthState(dependencies.sessionSecret);
    reply.setCookie(stateCookieName, state, {
      ...secureCookie,
      path: '/admin/auth/callback',
      maxAge: 600,
    });
    return reply.type('text/html').send(loginPage(oauth.authorizationUrl(state)));
  });
  app.get('/admin/auth/callback', async (request, reply) => {
    headers(reply);
    const parsed = querySchema.safeParse(request.query);
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
    headers(reply);
    const auth = await authenticatePost(request, reply);
    if (auth === null) return;
    await dependencies.sessions.revoke(auth.token);
    reply.clearCookie(sessionCookieName, secureCookie);
    return reply.redirect('/admin/login', 303);
  });
  app.get('/admin', async (request, reply) => {
    headers(reply);
    const auth = await authenticate(request, reply);
    if (auth === null) return;
    if (!dependencies.discord.isReady())
      return reply
        .code(503)
        .type('text/html')
        .send(page('Unavailable', '<h1>Discord is reconnecting</h1><p>Try again shortly.</p>'));
    const [tenManSettings, rewardSettings] = await Promise.all([
      dependencies.prisma.tenManSettings.findMany(),
      dependencies.prisma.rewardSettings.findMany(),
    ]);
    const tenManByGuild = new Map(tenManSettings.map((item) => [item.guildId, item]));
    const rewardsByGuild = new Map(rewardSettings.map((item) => [item.guildId, item]));
    const guilds = [...dependencies.discord.guilds.cache.values()]
      .map((item) => {
        const tenMan = tenManByGuild.get(item.id);
        const rewards = rewardsByGuild.get(item.id);
        return {
          id: item.id,
          name: item.name,
          tenManConfigured: tenMan !== undefined,
          tenManEnabled: tenMan?.enabled ?? false,
          rewardsConfigured: rewards !== undefined,
          rewardsEnabled: rewards?.enabled ?? false,
          managedState: tenMan?.managedResourceState ?? 'NONE',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return reply.type('text/html').send(guildIndex(auth.discordUserId, auth.csrf, guilds));
  });

  const renderGuild = async (
    guildId: string,
    csrf: string,
    notice?: string,
    report?: Awaited<ReturnType<DiagnosticsService['runGuildDiagnostics']>>,
  ) => {
    const discordGuild = guild(guildId);
    if (discordGuild === undefined) return null;
    const [settings, channels, roles, profiles] = await Promise.all([
      dependencies.prisma.tenManSettings.findUnique({ where: { guildId } }),
      discordGuild.channels.fetch(),
      discordGuild.roles.fetch(),
      dependencies.prisma.gameProfile.findMany({
        where: { enabled: true },
        orderBy: { key: 'asc' },
      }),
    ]);
    const values: Record<string, string | string[]> =
      settings === null
        ? {
            privilegedRoleIds: [],
            moderatorRoleIds: [],
            administratorRoleIds: [],
            defaultServerLocation: 'dallas',
            defaultGameProfileKey: profiles[0]?.key ?? '',
          }
        : {
            lobbyTextChannelId: settings.lobbyTextChannelId ?? '',
            lobbyVoiceChannelId: settings.lobbyVoiceChannelId ?? '',
            team1VoiceChannelId: settings.team1VoiceChannelId ?? '',
            team2VoiceChannelId: settings.team2VoiceChannelId ?? '',
            privilegedRoleIds: settings.privilegedRoleIds,
            moderatorRoleIds: settings.moderatorRoleIds,
            administratorRoleIds: settings.administratorRoleIds,
            dathostTemplateServerId: settings.dathostTemplateServerId ?? '',
            defaultServerLocation: settings.defaultServerLocation ?? '',
            defaultGameProfileKey: settings.defaultGameProfileKey ?? '',
          };
    const channelList = [...channels.values()].filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    return guildPage({
      id: guildId,
      name: discordGuild.name,
      version: settings?.version ?? null,
      enabled: settings?.enabled ?? false,
      managedState: settings?.managedResourceState ?? 'NONE',
      values,
      textChannels: channelList
        .filter((item) => item.type === ChannelType.GuildText)
        .map((item) => ({ id: item.id, name: item.name })),
      voiceChannels: channelList
        .filter((item) => item.type === ChannelType.GuildVoice)
        .map((item) => ({ id: item.id, name: item.name })),
      roles: [...roles.values()]
        .filter((item) => item.id !== discordGuild.id && !item.managed)
        .map((item) => ({ id: item.id, name: item.name })),
      profiles: profiles.map((item) => ({ id: item.key, name: item.key })),
      csrf,
      ...(notice === undefined ? {} : { notice }),
      ...(report === undefined ? {} : { diagnostics: report }),
    });
  };

  app.get('/admin/guilds/:guildId', async (request, reply) => {
    headers(reply);
    const auth = await authenticate(request, reply);
    if (auth === null) return;
    const parsed = z.object({ guildId: idSchema }).safeParse(request.params);
    if (!parsed.success)
      return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
    const html = await renderGuild(parsed.data.guildId, auth.csrf);
    return html === null
      ? reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'))
      : reply.type('text/html').send(html);
  });
  app.post('/admin/guilds/:guildId/settings', async (request, reply) => {
    headers(reply);
    const auth = await authenticatePost(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    const body = settingsSchema.safeParse(request.body);
    if (!params.success || guild(params.data.guildId) === undefined)
      return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
    if (!body.success)
      return reply
        .code(400)
        .type('text/html')
        .send(
          page(
            'Invalid settings',
            '<h1>Invalid settings</h1><p>Review every field and try again.</p>',
          ),
        );
    const current = await dependencies.prisma.tenManSettings.findUnique({
      where: { guildId: params.data.guildId },
    });
    if (
      (body.data.version === 'new') !== (current === null) ||
      (typeof body.data.version === 'number' && body.data.version !== current?.version)
    )
      return reply
        .code(409)
        .type('text/html')
        .send(page('Stale settings', '<h1>Configuration changed</h1><p>Reload and try again.</p>'));
    await dependencies.settings.update({
      guildId: params.data.guildId,
      actorDiscordUserId: auth.discordUserId,
      correlationId: randomUUID(),
      lobbyTextChannelId: body.data.lobbyTextChannelId,
      lobbyVoiceChannelId: body.data.lobbyVoiceChannelId,
      team1VoiceChannelId: body.data.team1VoiceChannelId,
      team2VoiceChannelId: body.data.team2VoiceChannelId,
      privilegedRoleIds: body.data.privilegedRoleIds,
      moderatorRoleIds: body.data.moderatorRoleIds,
      administratorRoleIds: body.data.administratorRoleIds,
      dathostTemplateServerId: body.data.dathostTemplateServerId,
      defaultServerLocation: body.data.defaultServerLocation || 'dallas',
      defaultGameProfileKey: body.data.defaultGameProfileKey,
      enabled: current?.enabled ?? false,
      expectedVersion: body.data.version === 'new' ? null : body.data.version,
    });
    return reply.redirect(`/admin/guilds/${params.data.guildId}`, 303);
  });
  for (const action of ['enable', 'disable'] as const)
    app.post(`/admin/guilds/:guildId/${action}`, async (request, reply) => {
      headers(reply);
      const auth = await authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
      await dependencies.resources[action](params.data.guildId, auth.discordUserId, randomUUID());
      return reply.redirect(`/admin/guilds/${params.data.guildId}`, 303);
    });
  app.get('/admin/guilds/:guildId/rewards', async (request, reply) => {
    headers(reply);
    const auth = await authenticate(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    const discordGuild = params.success ? guild(params.data.guildId) : undefined;
    if (!params.success || discordGuild === undefined)
      return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
    const [settings, levels, channels, roles, members, ledgerEntries, diagnostics] =
      await Promise.all([
        dependencies.prisma.rewardSettings.findUnique({ where: { guildId: params.data.guildId } }),
        dependencies.prisma.rewardLevel.findMany({
          where: { guildId: params.data.guildId },
          orderBy: { level: 'asc' },
        }),
        discordGuild.channels.fetch(),
        discordGuild.roles.fetch(),
        discordGuild.members.fetch(),
        dependencies.prisma.rewardLedgerEntry.findMany({
          where: { guildId: params.data.guildId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { member: { include: { user: { select: { displayName: true } } } } },
        }),
        rewardDiagnostics.run(params.data.guildId),
      ]);
    const channelList = [...channels.values()].filter(
      (channel): channel is NonNullable<typeof channel> => channel !== null,
    );
    return reply.type('text/html').send(
      rewardsPage({
        id: params.data.guildId,
        name: discordGuild.name,
        csrf: auth.csrf,
        adjustmentId: randomUUID(),
        settings: {
          version: settings?.version ?? null,
          enabled: settings?.enabled ?? false,
          textXpAmount: settings?.textXpAmount ?? 10,
          textCooldownSeconds: settings?.textCooldownSeconds ?? 60,
          voiceXpAmount: settings?.voiceXpAmount ?? 5,
          voiceIntervalSeconds: settings?.voiceIntervalSeconds ?? 300,
          textChannelIds: settings?.textChannelIds ?? [],
          voiceChannelIds: settings?.voiceChannelIds ?? [],
          tagRequiredSeconds: settings?.tagRequiredSeconds ?? 2592000,
          tagRewardRoleId: settings?.tagRewardRoleId ?? '',
          tagReconcileSeconds: settings?.tagReconcileSeconds ?? 900,
        },
        levels,
        textChannels: channelList
          .filter((channel) => channel.type === ChannelType.GuildText)
          .map((channel) => ({ id: channel.id, name: channel.name })),
        voiceChannels: channelList
          .filter((channel) => channel.type === ChannelType.GuildVoice)
          .map((channel) => ({ id: channel.id, name: channel.name })),
        roles: [...roles.values()]
          .filter((role) => role.id !== discordGuild.id && !role.managed)
          .map((role) => ({ id: role.id, name: role.name })),
        members: [...members.values()]
          .filter((member) => !member.user.bot)
          .map((member) => ({ id: member.id, name: member.displayName }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        ledgerEntries: ledgerEntries.map((entry) => ({
          member: entry.member.user.displayName,
          amount: entry.amount,
          source: entry.source,
          actorDiscordUserId: entry.actorDiscordUserId,
          reason: entry.reason,
          createdAt: entry.createdAt,
        })),
        diagnostics,
      }),
    );
  });
  app.post('/admin/guilds/:guildId/rewards/settings', async (request, reply) => {
    headers(reply);
    const auth = await authenticatePost(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    const body = rewardSettingsSchema.safeParse(request.body);
    if (!params.success || !body.success || guild(params.data.guildId) === undefined)
      return reply
        .code(400)
        .type('text/html')
        .send(page('Invalid settings', '<h1>Invalid reward settings</h1>'));
    await rewardSettings.update({
      guildId: params.data.guildId,
      actorDiscordUserId: auth.discordUserId,
      correlationId: randomUUID(),
      expectedVersion: body.data.version === 'new' ? null : body.data.version,
      textXpAmount: body.data.textXpAmount,
      textCooldownSeconds: body.data.textCooldownSeconds,
      voiceXpAmount: body.data.voiceXpAmount,
      voiceIntervalSeconds: body.data.voiceIntervalSeconds,
      textChannelIds: body.data.textChannelIds,
      voiceChannelIds: body.data.voiceChannelIds,
      tagRequiredSeconds: body.data.tagRequiredSeconds,
      ...(body.data.tagRewardRoleId === undefined || body.data.tagRewardRoleId === ''
        ? {}
        : { tagRewardRoleId: body.data.tagRewardRoleId }),
      tagReconcileSeconds: body.data.tagReconcileSeconds,
      levels: parseRewardLevels(
        body.data.levelNumbers,
        body.data.levelThresholds,
        body.data.levelLabels,
        body.data.levelRoleIds,
      ),
    });
    return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
  });
  for (const action of ['enable', 'disable'] as const)
    app.post(`/admin/guilds/:guildId/rewards/${action}`, async (request, reply) => {
      headers(reply);
      const auth = await authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      const body = rewardToggleSchema.safeParse(request.body);
      if (!params.success || !body.success || guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
      await rewardSettings.setEnabled(
        params.data.guildId,
        action === 'enable',
        auth.discordUserId,
        randomUUID(),
        body.data.version,
      );
      return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
    });
  app.post('/admin/guilds/:guildId/rewards/adjust', async (request, reply) => {
    headers(reply);
    const auth = await authenticatePost(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    const body = rewardAdjustmentSchema.safeParse(request.body);
    const discordGuild = params.success ? guild(params.data.guildId) : undefined;
    if (!params.success || !body.success || discordGuild === undefined)
      return reply
        .code(400)
        .type('text/html')
        .send(page('Invalid adjustment', '<h1>Invalid adjustment</h1>'));
    const member = await discordGuild.members.fetch(body.data.discordUserId);
    const correlationId = body.data.adjustmentId;
    await rewards.award({
      guildId: params.data.guildId,
      discordUserId: member.id,
      displayName: member.displayName,
      amount: body.data.amount,
      source: 'ADMIN_ADJUSTMENT',
      idempotencyKey: `admin:${correlationId}`,
      actorDiscordUserId: auth.discordUserId,
      reason: body.data.reason,
      correlationId,
    });
    return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
  });
  app.post('/admin/guilds/:guildId/diagnostics', async (request, reply) => {
    headers(reply);
    const auth = await authenticatePost(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    if (!params.success || guild(params.data.guildId) === undefined)
      return reply.code(404).type('text/html').send(page('Not found', '<h1>Not found</h1>'));
    const report = await dependencies.diagnostics.runGuildDiagnostics(params.data.guildId);
    const html = await renderGuild(params.data.guildId, auth.csrf, undefined, report);
    return reply.type('text/html').send(html ?? page('Not found', '<h1>Not found</h1>'));
  });
}

function parseRewardLevels(
  numbers: string[],
  thresholds: string[],
  labels: string[],
  roleIds: string[],
): RewardLevelInput[] {
  if (
    numbers.length !== thresholds.length ||
    numbers.length !== labels.length ||
    numbers.length !== roleIds.length
  ) {
    throw new Error('Reward level fields are incomplete');
  }
  return numbers.flatMap((levelValue, index) => {
    const thresholdValue = thresholds[index] ?? '';
    const label = (labels[index] ?? '').trim();
    const roleId = (roleIds[index] ?? '').trim();
    if (levelValue.trim() === '' && thresholdValue.trim() === '' && label === '' && roleId === '') {
      return [];
    }
    const level = Number(levelValue);
    const xpThreshold = Number(thresholdValue);
    if (!Number.isSafeInteger(level) || !Number.isSafeInteger(xpThreshold)) {
      throw new Error(`Invalid reward level on row ${String(index + 1)}`);
    }
    if (roleId !== '' && !/^\d{17,20}$/.test(roleId)) {
      throw new Error(`Invalid reward role on row ${String(index + 1)}`);
    }
    return [
      {
        level,
        xpThreshold,
        ...(label === '' ? {} : { label }),
        ...(roleId === '' ? {} : { roleId }),
      },
    ];
  });
}
