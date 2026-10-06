import { randomUUID } from 'node:crypto';
import { ChannelType, type Client } from 'discord.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { GameServerAdminService } from '../../../modules/game-servers/services/game-server-admin-service.js';
import type { GameServerDiagnosticsService } from '../../../modules/game-servers/services/game-server-diagnostics-service.js';
import type { DiagnosticsService } from '../../../modules/tenman/services/diagnostics-service.js';
import type { GuildResourceService } from '../../../modules/tenman/services/guild-resource-service.js';
import type { GuildSettingsService } from '../../../modules/tenman/services/guild-settings-service.js';
import type { WebSessionService } from '../../../services/web-session-service.js';
import { csrfToken, sessionCookieName, verifyCsrf } from '../../admin/security.js';
import { page } from '../../admin/views.js';

export const idSchema = z.string().regex(/^\d{17,20}$/);
export const csrfSchema = z.object({ csrf: z.string().min(1).max(128) });

export const moduleReleasePolicy = {
  'game-servers': 'production_ready',
  competitive: 'in_development',
  rewards: 'in_development',
} as const;

export type ModuleKey = keyof typeof moduleReleasePolicy;

export function isProductionReady(module: ModuleKey): boolean {
  return moduleReleasePolicy[module] === 'production_ready';
}

export interface AdminRoutesDependencies {
  prisma: PrismaClient;
  discord: Client;
  settings: GuildSettingsService;
  resources: GuildResourceService;
  diagnostics: DiagnosticsService;
  gameServerAdmin: GameServerAdminService;
  gameServerDiagnostics: GameServerDiagnosticsService;
  sessions: WebSessionService;
  publicBaseUrl: URL;
  clientId: string;
  clientSecret: string;
  ownerIds: readonly string[];
  sessionSecret: string;
}

export interface Authenticated {
  token: string;
  discordUserId: string;
  csrf: string;
}

export interface SharedHelpers {
  deps: AdminRoutesDependencies;
  ownerIds: Set<string>;
  secureCookie: { secure: boolean; httpOnly: boolean; sameSite: 'lax'; path: string };
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<Authenticated | null>;
  authenticatePost(request: FastifyRequest, reply: FastifyReply): Promise<Authenticated | null>;
  headers(reply: FastifyReply): FastifyReply;
  requestId(): string;
  staleReply(reply: FastifyReply, backPath: string): FastifyReply;
  renderError(
    reply: FastifyReply,
    backPath: string,
    message: string,
    status?: number,
  ): FastifyReply;
  guild(guildId: string): ReturnType<Client['guilds']['cache']['get']>;
  guildOptions(guildId: string): Promise<{
    textChannels: { id: string; name: string }[];
    voiceChannels: { id: string; name: string }[];
    roles: { id: string; name: string }[];
  } | null>;
  buildModuleSummaries(guildId: string): Promise<
    Record<
      ModuleKey,
      {
        key: ModuleKey;
        label: string;
        release: string;
        releaseVariant: string;
        operational: string;
        operationalVariant: string;
      }
    >
  >;
  recentAudit(
    guildId: string,
    take?: number,
  ): Promise<
    Array<{
      createdAt: Date;
      actor: string | null;
      module: string;
      action: string;
      result: string;
      summary: string;
    }>
  >;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createSharedHelpers(deps: AdminRoutesDependencies): SharedHelpers {
  const ownerIds = new Set(deps.ownerIds);
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
    const identity = await deps.sessions.resolve(token);
    if (identity === null || !ownerIds.has(identity.discordUserId)) {
      reply.clearCookie(sessionCookieName, secureCookie);
      await reply.redirect('/admin/login');
      return null;
    }
    return {
      token,
      discordUserId: identity.discordUserId,
      csrf: csrfToken(deps.sessionSecret, token),
    };
  };

  const authenticatePost = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Authenticated | null> => {
    const auth = await authenticate(request, reply);
    if (auth === null) return null;
    const parsed = csrfSchema.safeParse(request.body);
    if (!parsed.success || !verifyCsrf(deps.sessionSecret, auth.token, parsed.data.csrf)) {
      await reply
        .code(403)
        .type('text/html')
        .send(page('Forbidden', '<h1>Forbidden</h1><p>The form expired or was invalid.</p>'));
      return null;
    }
    return auth;
  };

  const requestId = () => randomUUID();

  const staleReply = (reply: FastifyReply, backPath: string) =>
    reply
      .code(409)
      .type('text/html')
      .send(
        page(
          'Configuration changed',
          `<h1>Configuration changed</h1><p>Another update happened first. <a href="${escapeHtml(backPath)}">Reload and try again</a>.</p>`,
        ),
      );

  const renderError = (
    reply: FastifyReply,
    backPath: string,
    message: string,
    status = 400,
  ): FastifyReply =>
    reply
      .code(status)
      .type('text/html')
      .send(
        page(
          'Error',
          `<h1>Error</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(backPath)}">Go back</a></p>`,
        ),
      );

  const guild = (guildId: string) => deps.discord.guilds.cache.get(guildId);

  const guildOptions = async (guildId: string) => {
    const discordGuild = guild(guildId);
    if (discordGuild === undefined) return null;
    const [channels, roles] = await Promise.all([
      discordGuild.channels.fetch(),
      discordGuild.roles.fetch(),
    ]);
    const channelList = [...channels.values()].filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    return {
      textChannels: channelList
        .filter((item) => item.type === ChannelType.GuildText)
        .map((item) => ({ id: item.id, name: item.name })),
      voiceChannels: channelList
        .filter((item) => item.type === ChannelType.GuildVoice)
        .map((item) => ({ id: item.id, name: item.name })),
      roles: [...roles.values()]
        .filter((item) => item.id !== discordGuild.id && !item.managed)
        .map((item) => ({ id: item.id, name: item.name })),
    };
  };

  const buildModuleSummaries = async (guildId: string) => {
    const [gameServerSettings, tenManSettings, rewardSettingsRow, gameServers] = await Promise.all([
      deps.prisma.gameServerSettings.findUnique({ where: { guildId } }),
      deps.prisma.tenManSettings.findUnique({ where: { guildId } }),
      deps.prisma.rewardSettings.findUnique({ where: { guildId } }),
      deps.prisma.gameServer.findMany({ where: { guildId }, include: { snapshot: true } }),
    ]);
    return {
      'game-servers': {
        key: 'game-servers' as const,
        label: 'Game Servers',
        release: 'Production ready',
        releaseVariant: 'production-ready',
        operational:
          gameServerSettings === null
            ? 'Unconfigured'
            : gameServerSettings.enabled
              ? gameServers.some(serverNeedsAttention)
                ? 'Needs attention'
                : 'Enabled'
              : 'Disabled',
        operationalVariant:
          gameServerSettings === null
            ? 'unconfigured'
            : gameServerSettings.enabled
              ? gameServers.some(serverNeedsAttention)
                ? 'needs-attention'
                : 'enabled'
              : 'disabled',
      },
      competitive: {
        key: 'competitive' as const,
        label: 'Competitive',
        release: 'In development',
        releaseVariant: 'in-development',
        operational:
          tenManSettings === null
            ? 'Unconfigured'
            : tenManSettings.enabled
              ? 'Enabled'
              : 'Disabled',
        operationalVariant:
          tenManSettings === null
            ? 'unconfigured'
            : tenManSettings.enabled
              ? 'enabled'
              : 'disabled',
      },
      rewards: {
        key: 'rewards' as const,
        label: 'Rewards',
        release: 'In development',
        releaseVariant: 'in-development',
        operational:
          rewardSettingsRow === null
            ? 'Unconfigured'
            : rewardSettingsRow.enabled
              ? 'Enabled'
              : 'Disabled',
        operationalVariant:
          rewardSettingsRow === null
            ? 'unconfigured'
            : rewardSettingsRow.enabled
              ? 'enabled'
              : 'disabled',
      },
    };
  };

  const recentAudit = async (guildId: string, take = 20) => {
    const entries = await deps.prisma.auditEvent.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return entries.map((entry) => ({
      createdAt: entry.createdAt,
      actor: entry.actorDiscordUserId,
      module: auditModule(entry.eventType),
      action: entry.eventType,
      result: entry.result,
      summary: auditSummary(entry.eventType, entry.metadata as Record<string, unknown>),
    }));
  };

  return {
    deps,
    ownerIds,
    secureCookie,
    authenticate,
    authenticatePost,
    headers,
    requestId,
    staleReply,
    renderError,
    guild,
    guildOptions,
    buildModuleSummaries,
    recentAudit,
  };
}

export function serverNeedsAttention(server: {
  enabled: boolean;
  snapshot: { stale: boolean; consecutiveFailures: number } | null;
}): boolean {
  return (
    server.enabled &&
    (server.snapshot === null || server.snapshot.stale || server.snapshot.consecutiveFailures > 0)
  );
}

function auditModule(eventType: string): string {
  if (eventType.startsWith('game_server')) return 'Game Servers';
  if (
    eventType.startsWith('guild') ||
    eventType.startsWith('tenman') ||
    eventType.startsWith('match') ||
    eventType.startsWith('queue')
  )
    return 'Competitive';
  if (eventType.startsWith('reward')) return 'Rewards';
  return 'System';
}

function auditSummary(eventType: string, metadata: Record<string, unknown>): string {
  const displayName =
    typeof metadata.displayName === 'string'
      ? metadata.displayName
      : JSON.stringify(metadata.displayName ?? '');
  if (eventType === 'game_server_removed') {
    return `Removed registration ${displayName.slice(0, 64)}`;
  }
  if (eventType === 'game_server_created') {
    return `Registered ${displayName.slice(0, 64)}`;
  }
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value).slice(0, 120)}`)
    .join('; ');
}
