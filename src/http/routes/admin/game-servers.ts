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

const displaySchema = z
  .object({ csrf: z.string().min(1).max(128), gameServerId: z.uuid(), channelId: idSchema })
  .strict();
const moveDisplaySchema = z
  .object({ csrf: z.string().min(1).max(128), channelId: idSchema })
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
        include: { snapshot: true, cards: true },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
      fetchTextChannels(guildId),
    ]);
    const available = await shared.deps.gameServerAdmin
      .listAvailableServers(guildId)
      .catch(
        () => [] as Awaited<ReturnType<typeof shared.deps.gameServerAdmin.listAvailableServers>>,
      );
    const cards = servers.flatMap((server) =>
      server.cards.map((card) => ({
        id: card.id,
        gameServerId: server.id,
        serverName: server.displayName,
        channelId: card.channelId,
        channelName:
          channels.find((channel) => channel.id === card.channelId)?.name ?? card.channelId,
        messageId: card.messageId,
        state: card.state,
        lastReconciledAt: card.lastReconciledAt,
        lastError: card.lastError,
      })),
    );
    return gameServersPage({
      id: guildId,
      name: shared.guild(guildId)?.name ?? '',
      username: auth.discordUserId,
      csrf: auth.csrf,
      moduleEnabled: settings?.enabled ?? false,
      settingsVersion: settings?.version ?? null,
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
        displays: server.cards.map((card) => ({
          id: card.id,
          channelName:
            channels.find((channel) => channel.id === card.channelId)?.name ?? card.channelId,
        })),
        needsAttention:
          server.enabled &&
          (server.snapshot === null ||
            server.snapshot.stale ||
            server.snapshot.consecutiveFailures > 0),
        version: server.version,
      })),
      filter: extras?.filter ?? 'all',
      cards,
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

  for (const action of ['publish', 'move', 'remove', 'reconcile'] as const)
    app.post(
      `/admin/guilds/:guildId/game-servers/displays${action === 'publish' ? '' : '/:cardId/' + action}`,
      async (request: FastifyRequest, reply: FastifyReply) => {
        shared.headers(reply);
        const auth = await shared.authenticatePost(request, reply);
        if (auth === null) return;
        const params = z
          .object({ guildId: idSchema, cardId: z.uuid().optional() })
          .safeParse(request.params);
        if (!params.success || shared.guild(params.data.guildId) === undefined)
          return reply.code(404).type('text/html').send('<h1>Not found</h1>');
        const cardId = params.data.cardId;
        if (action !== 'publish' && cardId === undefined)
          return shared.renderError(
            reply,
            `/admin/guilds/${params.data.guildId}/game-servers`,
            'Invalid display request.',
          );
        const body = (
          action === 'publish'
            ? displaySchema
            : action === 'move'
              ? moveDisplaySchema
              : z.object({ csrf: z.string().min(1).max(128), gameServerId: z.uuid() }).strict()
        ).safeParse(request.body);
        if (!body.success)
          return shared.renderError(
            reply,
            `/admin/guilds/${params.data.guildId}/game-servers`,
            'Invalid display request.',
          );
        try {
          const base = {
            guildId: params.data.guildId,
            actorDiscordUserId: auth.discordUserId,
            correlationId: shared.requestId(),
          };
          if (action === 'publish') {
            const data = body.data as z.infer<typeof displaySchema>;
            await shared.deps.gameServerAdmin.publishServerCard({
              ...base,
              gameServerId: data.gameServerId,
              channelId: data.channelId,
            });
          } else if (action === 'move') {
            const data = body.data as z.infer<typeof moveDisplaySchema>;
            if (cardId === undefined)
              throw new PublicError('INVALID_REQUEST', 'Invalid display request.');
            await shared.deps.gameServerAdmin.moveServerCard({
              ...base,
              cardId,
              channelId: data.channelId,
            });
          } else if (action === 'remove') {
            const data = body.data as { gameServerId: string };
            if (cardId === undefined)
              throw new PublicError('INVALID_REQUEST', 'Invalid display request.');
            await shared.deps.gameServerAdmin.removeServerCard({
              ...base,
              cardId,
              gameServerId: data.gameServerId,
            });
          } else {
            if (cardId === undefined)
              throw new PublicError('INVALID_REQUEST', 'Invalid display request.');
            await shared.deps.gameServerAdmin.reconcileServerCard(params.data.guildId, cardId);
          }
        } catch (error: unknown) {
          const html = await buildGameServersPage(params.data.guildId, auth, {
            errors: [
              error instanceof PublicError
                ? error.publicMessage
                : 'Could not update Discord display.',
            ],
          });
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
    const channels = await fetchTextChannels(guildId);
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
              gameplayState: server.snapshot.gameplayState,
              hostname: server.snapshot.hostname,
              rawIp: server.snapshot.rawIp,
              port: server.snapshot.port,
              map: server.snapshot.map,
              players: server.snapshot.players,
              maxPlayers: server.snapshot.maxPlayers,
              datacenter: server.snapshot.datacenter,
              cpuPercent: server.snapshot.cpuPercent,
              memoryUsageMb: server.snapshot.memoryUsageMb,
              averagePingMs: server.snapshot.averagePingMs,
              packetLossPercent: server.snapshot.packetLossPercent,
              serverVarMs: server.snapshot.serverVarMs,
              observedAt: server.snapshot.observedAt,
              lastSuccessfulAt: server.snapshot.lastSuccessfulAt,
              lastOnlineAt: server.snapshot.lastOnlineAt,
              consecutiveFailures: server.snapshot.consecutiveFailures,
              stale: server.snapshot.stale,
              lastError: server.snapshot.lastError,
            },
      textChannels: channels,
      cards: server.cards.map((card) => ({
        id: card.id,
        channelId: card.channelId,
        channelName:
          channels.find((channel) => channel.id === card.channelId)?.name ?? card.channelId,
        messageId: card.messageId,
        state: card.state,
        lastReconciledAt: card.lastReconciledAt,
        lastError: card.lastError,
      })),
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
