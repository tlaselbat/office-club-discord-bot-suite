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
import {
  CARD_TEMPLATE_FIELDS,
  CARD_BODY_FIELDS,
  DEFAULT_CARD_TEMPLATES,
  DEFAULT_STATUS_LABELS,
  cardProfileSchema,
  isHttpsUrl,
  validateCardTemplate,
  CARD_LINE_IDS,
  CARD_LINE_STYLES,
  cardLayoutSchema,
} from '../../../modules/game-servers/card-profile.js';

const optionalHttpsUrl = z
  .string()
  .max(500)
  .refine((value) => value === '' || isHttpsUrl(value), 'Must be a valid HTTPS URL')
  .optional();

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
    joinUrl: optionalHttpsUrl,
    imageUrl: optionalHttpsUrl,
    sortOrder: z.coerce.number().int().min(0).default(0),
    accentColor: cardProfileSchema.shape.accentColor,
    thumbnailImageUrl: optionalHttpsUrl,
    onlineEmojiId: z.string().max(20).optional(),
    offlineEmojiId: z.string().max(20).optional(),
    warningEmojiId: z.string().max(20).optional(),
    pendingEmojiId: z.string().max(20).optional(),
    titleTemplate: z.string().max(500).default(DEFAULT_CARD_TEMPLATES.title),
    subtitleTemplate: z.string().max(500).default(DEFAULT_CARD_TEMPLATES.subtitle),
    descriptionTemplate: z.string().max(500).optional(),
    playerCountTemplate: z.string().max(500).default(DEFAULT_CARD_TEMPLATES.playerCount),
    currentMapTemplate: z.string().max(500).default(DEFAULT_CARD_TEMPLATES.currentMap),
    serverAddressTemplate: z.string().max(500).default(DEFAULT_CARD_TEMPLATES.serverAddress),
    linesVersion: z.literal('1').optional(),
    layoutVersion: z.literal('1').optional(),
    layoutJson: z.string().max(30000).optional(),
    lineOrder: z.string().max(100).optional(),
    titleStyle: z.enum(CARD_LINE_STYLES).default('large'),
    subtitleStyle: z.enum(CARD_LINE_STYLES).default('small'),
    playerCountStyle: z.enum(CARD_LINE_STYLES).default('subtext'),
    descriptionStyle: z.enum(CARD_LINE_STYLES).default('normal'),
    currentMapStyle: z.enum(CARD_LINE_STYLES).default('normal'),
    serverAddressStyle: z.enum(CARD_LINE_STYLES).default('normal'),
    showMapArtwork: z.literal('1').optional(),
    showTitle: z.literal('1').optional(),
    showSubtitle: z.literal('1').optional(),
    showDescription: z.literal('1').optional(),
    showPlayerCount: z.literal('1').optional(),
    showCurrentMap: z.literal('1').optional(),
    showServerAddress: z.literal('1').optional(),
    showUpdates: z.literal('1').optional(),
    fieldOrder: z.string().max(100).default(CARD_BODY_FIELDS.join(',')),
    showConnectButton: z.literal('1').optional(),
    showMapRulesButton: z.literal('1').optional(),
    connectButtonLabel: z.string().trim().min(1).max(80).default('Connect'),
    mapRulesButtonLabel: z.string().trim().min(1).max(80).default('Map & Rules'),
    onlineStatusLabel: z.string().trim().min(1).max(80).optional(),
    offlineStatusLabel: z.string().trim().min(1).max(80).optional(),
    startingStatusLabel: z.string().trim().min(1).max(80).optional(),
    staleStatusLabel: z.string().trim().min(1).max(80).optional(),
    pendingStatusLabel: z.string().trim().min(1).max(80).optional(),
    unavailableStatusLabel: z.string().trim().min(1).max(80).optional(),
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
    let inventoryError: string | undefined;
    const available = await shared.deps.gameServerAdmin.listAvailableServers(guildId).catch(() => {
      inventoryError =
        'DatHost inventory is unavailable. Saved servers and displays are still shown; retry registration later.';
      return [] as Awaited<ReturnType<typeof shared.deps.gameServerAdmin.listAvailableServers>>;
    });
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
      moduleEnabled: settings?.enabled ?? true,
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
      errors: [
        ...(extras?.errors ?? []),
        ...(inventoryError === undefined ? [] : [inventoryError]),
      ],
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
      try {
        const report = await shared.deps.gameServerDiagnostics.runLive(params.data.guildId);
        const html = await buildGameServersPage(params.data.guildId, auth, { diagnostics: report });
        return await reply.type('text/html').send(html);
      } catch (error: unknown) {
        const html = await buildGameServersPage(params.data.guildId, auth, {
          errors: [
            error instanceof PublicError
              ? error.publicMessage
              : 'Diagnostics are unavailable. Retry shortly.',
          ],
        });
        return reply.code(400).type('text/html').send(html);
      }
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
    extras?: {
      errors?: string[];
      notice?: string;
      fieldErrors?: Record<string, string[]>;
      submitted?: Record<string, unknown>;
    },
  ) => {
    const server = await shared.deps.prisma.gameServer.findFirst({
      where: { id: serverId, guildId },
      include: { snapshot: true, cards: true, updateThreads: true },
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
        cardProfile: server.cardProfile,
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
      updateThreads: server.updateThreads.map((thread) => ({
        type: thread.type,
        threadId: thread.threadId,
        latestMessageText: thread.latestMessageText,
        latestMessageAt: thread.latestMessageAt,
        notificationExpiresAt: thread.notificationExpiresAt,
      })),
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
      ...(extras?.submitted === undefined ? {} : { submitted: extras.submitted }),
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
      const saved = (request.query as Record<string, unknown> | undefined)?.saved === '1';
      const html = await loadServerModel(
        params.data.guildId,
        params.data.serverId,
        auth,
        saved
          ? {
              notice:
                'Configuration saved. Discord reconciliation is processed separately; check Deployments for display status.',
            }
          : undefined,
      );
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
      const submitted =
        typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      if (!body.success) {
        const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
          errors: ['Review the fields and try again.'],
          fieldErrors: z.flattenError(body.error).fieldErrors,
          submitted,
        });
        return reply.code(400).type('text/html').send(html);
      }
      const profile = cardProfileSchema.safeParse({
        ...(body.data.layoutVersion === '1'
          ? (() => {
              let layout: unknown;
              try {
                layout = JSON.parse(body.data.layoutJson ?? '');
              } catch {
                layout = null;
              }
              return { layout };
            })()
          : {}),
        ...(body.data.linesVersion === '1'
          ? {
              textLines: (body.data.lineOrder ?? CARD_LINE_IDS.join(',')).split(',').map((id) => {
                const key = id.trim() as (typeof CARD_LINE_IDS)[number];
                return {
                  id: key,
                  template: body.data[`${key}Template`] ?? '',
                  style: body.data[`${key}Style`],
                  visible: submitted[`show${key.charAt(0).toUpperCase()}${key.slice(1)}`] === '1',
                };
              }),
              mapArtwork: body.data.showMapArtwork === '1',
            }
          : {}),
        accentColor: body.data.accentColor,
        thumbnailImageUrl: body.data.thumbnailImageUrl || null,
        onlineEmojiId: body.data.onlineEmojiId || null,
        offlineEmojiId: body.data.offlineEmojiId || null,
        warningEmojiId: body.data.warningEmojiId || null,
        pendingEmojiId: body.data.pendingEmojiId || null,
        templates: {
          title: body.data.titleTemplate,
          subtitle: body.data.subtitleTemplate,
          description:
            body.data.descriptionTemplate ??
            body.data.description ??
            DEFAULT_CARD_TEMPLATES.description,
          playerCount: body.data.playerCountTemplate,
          currentMap: body.data.currentMapTemplate,
          serverAddress: body.data.serverAddressTemplate,
        },
        visibleFields: {
          title: body.data.showTitle === '1',
          subtitle: body.data.showSubtitle === '1',
          description: body.data.showDescription === '1',
          playerCount: body.data.showPlayerCount === '1',
          currentMap: body.data.showCurrentMap === '1',
          serverAddress: body.data.showServerAddress === '1',
          updates: body.data.showUpdates === '1',
        },
        fieldOrder: body.data.fieldOrder.split(',').map((field) => field.trim()),
        buttons: {
          connect: body.data.showConnectButton === '1',
          mapRules: body.data.showMapRulesButton === '1',
          connectLabel: body.data.connectButtonLabel,
          mapRulesLabel: body.data.mapRulesButtonLabel,
        },
        statusLabels: {
          online: body.data.onlineStatusLabel ?? DEFAULT_STATUS_LABELS.online,
          offline: body.data.offlineStatusLabel ?? DEFAULT_STATUS_LABELS.offline,
          starting: body.data.startingStatusLabel ?? DEFAULT_STATUS_LABELS.starting,
          stale: body.data.staleStatusLabel ?? DEFAULT_STATUS_LABELS.stale,
          pending: body.data.pendingStatusLabel ?? DEFAULT_STATUS_LABELS.pending,
          unavailable: body.data.unavailableStatusLabel ?? DEFAULT_STATUS_LABELS.unavailable,
        },
      });
      const templateErrors = CARD_TEMPLATE_FIELDS.flatMap((field) =>
        validateCardTemplate(body.data[`${field}Template`] ?? body.data.description ?? ''),
      );
      if (templateErrors.length > 0) {
        const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
          errors: templateErrors,
          submitted,
        });
        return reply.code(400).type('text/html').send(html);
      }
      if (!profile.success) {
        let submittedLayout: unknown = null;
        if (body.data.layoutVersion === '1') {
          try {
            submittedLayout = JSON.parse(body.data.layoutJson ?? '') as unknown;
          } catch {
            submittedLayout = null;
          }
        }
        const layoutInvalid =
          body.data.layoutVersion === '1' && !cardLayoutSchema.safeParse(submittedLayout).success;
        const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
          errors: [
            ...(layoutInvalid
              ? [
                  'The Card Layout is invalid. Check unique IDs, HTTPS image URLs, and supported element settings.',
                ]
              : []),
            'Review the Card Profile fields and try again.',
          ],
          fieldErrors: z.flattenError(profile.error).fieldErrors,
          submitted,
        });
        return reply.code(400).type('text/html').send(html);
      }
      const emojiIds = [
        profile.data.onlineEmojiId,
        profile.data.offlineEmojiId,
        profile.data.warningEmojiId,
        profile.data.pendingEmojiId,
      ].filter((id): id is string => id !== null);
      if (emojiIds.length > 0) {
        const guild = shared.guild(params.data.guildId);
        if (guild === undefined)
          return reply.code(404).type('text/html').send('<h1>Not found</h1>');
        try {
          const available = await guild.emojis.fetch();
          if (emojiIds.some((id) => !available.has(id))) {
            const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
              errors: [
                'Each configured status emoji must be available in this Discord server and usable by the bot.',
              ],
              submitted,
            });
            return await reply.code(400).type('text/html').send(html);
          }
        } catch {
          const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
            errors: ['Could not verify configured status emojis with Discord. Try again.'],
            submitted,
          });
          return await reply.code(400).type('text/html').send(html);
        }
      }
      try {
        await shared.deps.gameServerAdmin.updateServer({
          guildId: params.data.guildId,
          gameServerId: params.data.serverId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          expectedVersion: body.data.version,
          displayName: body.data.displayName,
          description:
            body.data.descriptionTemplate ??
            body.data.description ??
            DEFAULT_CARD_TEMPLATES.description,
          enabled: body.data.enabled === '1',
          public: body.data.public === '1',
          connectDomain: body.data.connectDomain,
          joinUrl: body.data.joinUrl,
          imageUrl: body.data.imageUrl,
          sortOrder: body.data.sortOrder,
          cardProfile: profile.data,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not update server.';
        const html = await loadServerModel(params.data.guildId, params.data.serverId, auth, {
          errors: [message],
          submitted,
        });
        return reply
          .code(error instanceof PublicError && error.code === 'STALE_CONFIGURATION' ? 409 : 400)
          .type('text/html')
          .send(html);
      }
      return reply.redirect(
        `/admin/guilds/${params.data.guildId}/game-servers/${params.data.serverId}/edit?saved=1#card-designer`,
        303,
      );
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
