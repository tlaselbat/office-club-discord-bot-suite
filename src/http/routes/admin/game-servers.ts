import { ChannelType } from 'discord.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PublicError } from '../../../errors/public-error.js';
import {
  disableModuleConfirmPage,
  gameServerEditPage,
  gameServersPage,
  removeServerConfirmPage,
} from '../../admin/views.js';
import { idSchema } from './shared.js';
import type { SharedHelpers } from './shared.js';

const panelDestinationSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.union([z.literal('new'), z.coerce.number().int().nonnegative()]),
    panelChannelId: idSchema,
  })
  .strict();

const moduleToggleSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.coerce.number().int().nonnegative(),
  })
  .strict();

const serverAddSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    displayName: z.string().trim().min(1).max(64),
    providerServerId: z.string().min(1).max(128),
  })
  .strict();

const serverToggleSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.coerce.number().int().nonnegative(),
  })
  .strict();

const serverEditSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.coerce.number().int().nonnegative(),
    displayName: z.string().trim().min(1).max(64),
    description: z.string().max(500).optional(),
    enabled: z.literal('1').optional(),
    public: z.literal('1').optional(),
    connectDomain: z.string().max(256).optional(),
    joinUrl: z.string().max(500).optional(),
    imageUrl: z.string().max(500).optional(),
    sortOrder: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export function registerGameServersRoutes(app: FastifyInstance, shared: SharedHelpers): void {
  const fetchTextChannels = async (guildId: string) => {
    const discordGuild = shared.guild(guildId);
    if (discordGuild === undefined) return [];
    const channels = await discordGuild.channels.fetch();
    return [...channels.values()]
      .filter(
        (item): item is NonNullable<typeof item> =>
          item !== null && item.type === ChannelType.GuildText,
      )
      .map((item) => ({ id: item.id, name: item.name }));
  };

  const buildGameServersPage = async (
    guildId: string,
    auth: { discordUserId: string; csrf: string },
    extras?: {
      diagnostics?: Awaited<ReturnType<typeof shared.deps.gameServerDiagnostics.runPersisted>>;
      errors?: string[];
      notice?: string;
      filter?: 'all' | 'healthy' | 'needs-attention' | 'disabled';
    },
  ) => {
    const [settings, servers, channels] = await Promise.all([
      shared.deps.prisma.gameServerSettings.findUnique({ where: { guildId } }),
      shared.deps.prisma.gameServer.findMany({
        where: { guildId },
        include: { snapshot: true, cards: { select: { id: true } } },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
      fetchTextChannels(guildId),
    ]);
    const available = await shared.deps.gameServerAdmin
      .listAvailableServers(guildId)
      .catch(
        () => [] as Awaited<ReturnType<typeof shared.deps.gameServerAdmin.listAvailableServers>>,
      );
    const panelMessageOk =
      settings?.panelChannelId !== undefined &&
      settings.panelChannelId !== null &&
      settings.panelMessageId !== null;
    return gameServersPage({
      id: guildId,
      name: shared.guild(guildId)?.name ?? '',
      username: auth.discordUserId,
      csrf: auth.csrf,
      moduleEnabled: settings?.enabled ?? false,
      settingsVersion: settings?.version ?? null,
      panelChannelId: settings?.panelChannelId ?? undefined,
      panelChannelName: channels.find((channel) => channel.id === settings?.panelChannelId)?.name,
      panelMessageOk,
      textChannels: channels,
      servers: servers.map((server) => ({
        id: server.id,
        displayName: server.displayName,
        provider: server.provider,
        providerServerId: server.providerServerId,
        enabled: server.enabled,
        public: server.public,
        hostingState: server.snapshot?.hostingState ?? 'UNKNOWN',
        stale: server.snapshot?.stale ?? true,
        lastSuccessfulAt: server.snapshot?.lastSuccessfulAt ?? null,
        consecutiveFailures: server.snapshot?.consecutiveFailures ?? 0,
        cardCount: server.cards.length,
        needsAttention:
          server.enabled &&
          (server.snapshot === null ||
            server.snapshot.stale ||
            server.snapshot.consecutiveFailures > 0),
        version: server.version,
      })),
      filter: extras?.filter ?? 'all',
      availableServers: available,
      ...(extras?.diagnostics === undefined ? {} : { diagnostics: extras.diagnostics }),
      ...(extras?.errors === undefined ? {} : { errors: extras.errors }),
      ...(extras?.notice === undefined ? {} : { notice: extras.notice }),
    });
  };

  app.get(
    '/admin/guilds/:guildId/game-servers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticate(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const query = z
        .object({
          filter: z.enum(['all', 'healthy', 'needs-attention', 'disabled']).default('all'),
        })
        .safeParse(request.query);
      const html = await buildGameServersPage(params.data.guildId, auth, {
        filter: query.success ? query.data.filter : 'all',
      });
      return reply.type('text/html').send(html);
    },
  );

  app.get(
    '/admin/guilds/:guildId/game-servers/disable-confirm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticate(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const settings = await shared.deps.prisma.gameServerSettings.findUnique({
        where: { guildId: params.data.guildId },
      });
      return reply.type('text/html').send(
        disableModuleConfirmPage({
          id: params.data.guildId,
          name: shared.guild(params.data.guildId)?.name ?? '',
          username: auth.discordUserId,
          csrf: auth.csrf,
          version: settings?.version ?? null,
        }),
      );
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/enable',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const body = moduleToggleSchema.safeParse(request.body);
      if (!body.success)
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/game-servers`,
          'Invalid request.',
        );
      try {
        await shared.deps.gameServerAdmin.setModuleEnabled({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          enabled: true,
          expectedVersion: body.data.version,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not enable Game Servers.';
        const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/disable',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const body = moduleToggleSchema.safeParse(request.body);
      if (!body.success)
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/game-servers`,
          'Invalid request.',
        );
      try {
        await shared.deps.gameServerAdmin.setModuleEnabled({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          enabled: false,
          expectedVersion: body.data.version,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not disable Game Servers.';
        const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/panel',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const body = panelDestinationSchema.safeParse(request.body);
      if (!body.success)
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/game-servers`,
          'Invalid panel channel.',
        );
      try {
        await shared.deps.gameServerAdmin.updatePanelDestination({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          panelChannelId: body.data.panelChannelId,
          expectedVersion: body.data.version === 'new' ? null : body.data.version,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError
            ? error.publicMessage
            : 'Could not update panel destination.';
        const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/repair',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      try {
        await shared.deps.gameServerAdmin.repairPanel(
          params.data.guildId,
          auth.discordUserId,
          shared.requestId(),
        );
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not repair panel.';
        const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/diagnostics',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const report = await shared.deps.gameServerDiagnostics.runLive(params.data.guildId);
      const html = await buildGameServersPage(params.data.guildId, auth, { diagnostics: report });
      return reply.type('text/html').send(html);
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/add',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const body = serverAddSchema.safeParse(request.body);
      if (!body.success)
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/game-servers`,
          'Invalid server details.',
        );
      try {
        await shared.deps.gameServerAdmin.registerServer({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          displayName: body.data.displayName,
          providerServerId: body.data.providerServerId,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not register server.';
        const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );

  // Server detail/edit
  const loadServerModel = async (
    guildId: string,
    serverId: string,
    auth: { discordUserId: string; csrf: string },
    extras?: { errors?: string[]; notice?: string; fieldErrors?: Record<string, string[]> },
  ) => {
    const server = await shared.deps.prisma.gameServer.findFirst({
      where: { id: serverId, guildId },
      include: { snapshot: true, cards: true },
    });
    if (server === null) return null;
    const card = server.cards[0];
    return gameServerEditPage({
      guildId,
      guildName: shared.guild(guildId)?.name ?? '',
      username: auth.discordUserId,
      csrf: auth.csrf,
      server: {
        id: server.id,
        displayName: server.displayName,
        description: server.description,
        enabled: server.enabled,
        public: server.public,
        connectDomain: server.connectDomain,
        joinUrl: server.joinUrl,
        imageUrl: server.imageUrl,
        sortOrder: server.sortOrder,
        provider: server.provider,
        providerServerId: server.providerServerId,
        version: server.version,
      },
      snapshot:
        server.snapshot === null
          ? undefined
          : {
              hostingState: server.snapshot.hostingState,
              map: server.snapshot.map,
              players: server.snapshot.players,
              maxPlayers: server.snapshot.maxPlayers,
              datacenter: server.snapshot.datacenter,
              observedAt: server.snapshot.observedAt,
              lastError: server.snapshot.lastError,
            },
      cardState:
        card === undefined
          ? undefined
          : {
              channelId: card.channelId,
              messageId: card.messageId,
            },
      ...(extras?.errors === undefined ? {} : { errors: extras.errors }),
      ...(extras?.notice === undefined ? {} : { notice: extras.notice }),
      ...(extras?.fieldErrors === undefined ? {} : { fieldErrors: extras.fieldErrors }),
    });
  };

  app.get(
    '/admin/guilds/:guildId/game-servers/:serverId/edit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticate(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema, serverId: z.uuid() }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const html = await loadServerModel(params.data.guildId, params.data.serverId, auth);
      if (html === null) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      return reply.type('text/html').send(html);
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/:serverId/edit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema, serverId: z.uuid() }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const body = serverEditSchema.safeParse(request.body);
      if (!body.success) {
        const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
          errors: ['Review the fields and try again.'],
        });
        return reply.code(400).type('text/html').send(html);
      }
      try {
        await shared.deps.gameServerAdmin.updateServer({
          guildId: params.data.guildId,
          gameServerId: params.data.serverId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          expectedVersion: body.data.version,
          displayName: body.data.displayName,
          description: body.data.description,
          enabled: body.data.enabled === '1',
          public: body.data.public === '1',
          connectDomain: body.data.connectDomain,
          joinUrl: body.data.joinUrl,
          imageUrl: body.data.imageUrl,
          sortOrder: body.data.sortOrder,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not update server.';
        const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
          errors: [message],
        });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );

  for (const action of ['toggle-enabled', 'toggle-public'] as const)
    app.post(
      `/admin/guilds/:guildId/game-servers/:serverId/${action}`,
      async (request: FastifyRequest, reply: FastifyReply) => {
        shared.headers(reply);
        const auth = await shared.authenticatePost(request, reply);
        if (auth === null) return;
        const params = z
          .object({ guildId: idSchema, serverId: z.uuid() })
          .safeParse(request.params);
        if (!params.success || shared.guild(params.data.guildId) === undefined)
          return reply.code(404).type('text/html').send('<h1>Not found</h1>');
        const body = serverToggleSchema.safeParse(request.body);
        if (!body.success)
          return shared.renderError(
            reply,
            `/admin/guilds/${params.data.guildId}/game-servers`,
            'Invalid request.',
          );
        const server = await shared.deps.prisma.gameServer.findFirst({
          where: { id: params.data.serverId, guildId: params.data.guildId },
        });
        if (server === null) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
        try {
          if (action === 'toggle-enabled') {
            await shared.deps.gameServerAdmin.setServerEnabled({
              guildId: params.data.guildId,
              gameServerId: params.data.serverId,
              actorDiscordUserId: auth.discordUserId,
              correlationId: shared.requestId(),
              expectedVersion: body.data.version,
              enabled: !server.enabled,
            });
          } else {
            await shared.deps.gameServerAdmin.setServerPublic({
              guildId: params.data.guildId,
              gameServerId: params.data.serverId,
              actorDiscordUserId: auth.discordUserId,
              correlationId: shared.requestId(),
              expectedVersion: body.data.version,
              public: !server.public,
            });
          }
        } catch (error: unknown) {
          const message =
            error instanceof PublicError ? error.publicMessage : 'Could not update server.';
          const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
          return reply.code(400).type('text/html').send(html);
        }
        return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
      },
    );

  app.get(
    '/admin/guilds/:guildId/game-servers/:serverId/remove-confirm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticate(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema, serverId: z.uuid() }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const server = await shared.deps.prisma.gameServer.findFirst({
        where: { id: params.data.serverId, guildId: params.data.guildId },
      });
      if (server === null) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      return reply.type('text/html').send(
        removeServerConfirmPage({
          guildId: params.data.guildId,
          guildName: shared.guild(params.data.guildId)?.name ?? '',
          username: auth.discordUserId,
          csrf: auth.csrf,
          server: { id: server.id, displayName: server.displayName },
        }),
      );
    },
  );

  app.post(
    '/admin/guilds/:guildId/game-servers/:serverId/remove',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema, serverId: z.uuid() }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      try {
        await shared.deps.gameServerAdmin.removeServerRegistration({
          guildId: params.data.guildId,
          gameServerId: params.data.serverId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError
            ? error.publicMessage
            : 'Could not remove server registration.';
        const html = await buildGameServersPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/game-servers`, 303);
    },
  );
}
