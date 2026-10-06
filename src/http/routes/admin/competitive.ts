import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { competitivePage } from '../../admin/views.js';
import type { SharedHelpers } from './shared.js';
import { idSchema, isProductionReady } from './shared.js';

const settingsSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.union([z.literal('new'), z.coerce.number().int().nonnegative()]),
    lobbyTextChannelId: idSchema,
    lobbyVoiceChannelId: idSchema,
    team1VoiceChannelId: idSchema,
    team2VoiceChannelId: idSchema,
    privilegedRoleIds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(idSchema).min(1).max(25),
    ),
    moderatorRoleIds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(idSchema).min(1).max(25),
    ),
    administratorRoleIds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(idSchema).min(1).max(25),
    ),
    dathostTemplateServerId: z.string().min(1).max(128),
    defaultServerLocation: z.string().max(64).optional(),
    defaultGameProfileKey: z.string().min(1).max(64),
  })
  .strict();

export function registerCompetitiveRoutes(app: FastifyInstance, shared: SharedHelpers): void {
  const renderCompetitivePage = async (
    guildId: string,
    discordGuild: { name: string },
    auth: { discordUserId: string; csrf: string },
    diagnostics?: Awaited<ReturnType<typeof shared.deps.diagnostics.runGuildDiagnostics>>,
    errors?: string[],
  ) => {
    const [settings, options, profiles] = await Promise.all([
      shared.deps.prisma.tenManSettings.findUnique({ where: { guildId } }),
      shared.guildOptions(guildId),
      shared.deps.prisma.gameProfile.findMany({
        where: { enabled: true },
        orderBy: { key: 'asc' },
      }),
    ]);
    if (options === null) throw new Error('Guild options unavailable');
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
    return competitivePage({
      id: guildId,
      name: discordGuild.name,
      username: auth.discordUserId,
      csrf: auth.csrf,
      version: settings?.version ?? null,
      enabled: settings?.enabled ?? false,
      release: 'In development',
      releaseVariant: 'in-development',
      managedState: settings?.managedResourceState ?? 'NONE',
      locked: (settings?.managedResourceState ?? 'NONE') !== 'NONE',
      inDevelopment: true,
      values,
      textChannels: options.textChannels,
      voiceChannels: options.voiceChannels,
      roles: options.roles,
      profiles: profiles.map((profile) => ({ id: profile.key, name: profile.key })),
      ...(diagnostics === undefined ? {} : { diagnostics }),
      ...(errors === undefined ? {} : { errors }),
    });
  };

  app.get(
    '/admin/guilds/:guildId/competitive',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticate(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const discordGuild = shared.guild(params.data.guildId);
      if (discordGuild === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const html = await renderCompetitivePage(params.data.guildId, discordGuild, auth);
      return reply.type('text/html').send(html);
    },
  );

  app.post(
    '/admin/guilds/:guildId/competitive/settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const discordGuild = shared.guild(params.data.guildId);
      if (discordGuild === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      if (!isProductionReady('competitive'))
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/competitive`,
          'Competitive is not production-ready.',
          403,
        );
      const body = settingsSchema.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .type('text/html')
          .send('<h1>Invalid settings</h1><p>Review every field and try again.</p>');
      const current = await shared.deps.prisma.tenManSettings.findUnique({
        where: { guildId: params.data.guildId },
      });
      if (
        (body.data.version === 'new') !== (current === null) ||
        (typeof body.data.version === 'number' && body.data.version !== current?.version)
      )
        return shared.staleReply(reply, `/admin/guilds/${params.data.guildId}/competitive`);
      try {
        await shared.deps.settings.update({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
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
      } catch (error: unknown) {
        const message =
          error instanceof Error && 'publicMessage' in error
            ? String((error as { publicMessage?: string }).publicMessage)
            : 'Could not save settings.';
        const html = await renderCompetitivePage(
          params.data.guildId,
          discordGuild,
          auth,
          undefined,
          [message],
        );
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/competitive`, 303);
    },
  );

  for (const action of ['enable', 'disable'] as const)
    app.post(
      `/admin/guilds/:guildId/competitive/${action}`,
      async (request: FastifyRequest, reply: FastifyReply) => {
        shared.headers(reply);
        const auth = await shared.authenticatePost(request, reply);
        if (auth === null) return;
        const params = z.object({ guildId: idSchema }).safeParse(request.params);
        if (!params.success) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
        const discordGuild = shared.guild(params.data.guildId);
        if (discordGuild === undefined)
          return reply.code(404).type('text/html').send('<h1>Not found</h1>');
        await shared.deps.resources[action](
          params.data.guildId,
          auth.discordUserId,
          shared.requestId(),
        );
        return reply.redirect(`/admin/guilds/${params.data.guildId}/competitive`, 303);
      },
    );

  app.post(
    '/admin/guilds/:guildId/competitive/diagnostics',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const discordGuild = shared.guild(params.data.guildId);
      if (discordGuild === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const report = await shared.deps.diagnostics.runGuildDiagnostics(params.data.guildId);
      const html = await renderCompetitivePage(params.data.guildId, discordGuild, auth, report);
      return reply.type('text/html').send(html);
    },
  );
}
