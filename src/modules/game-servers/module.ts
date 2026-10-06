import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type MessageComponentInteraction,
  type GuildTextBasedChannel,
  type ClientEvents,
} from 'discord.js';
import type { Logger } from 'pino';
import type { SuiteModule } from '../../core/modules/types.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { DatHostServerReader } from '../../integrations/dathost/client.js';
import { PublicError } from '../../errors/public-error.js';
import type { JobHandler, LeasedJob } from '../../jobs/worker.js';
import { gameServerCommands } from './commands.js';
import { createGameServerCustomId, parseGameServerCustomId } from './custom-id.js';
import { GameServerCardService } from './card-service.js';
import { GameServerPollService, scheduleGameServerPoll } from './poll-service.js';
import { DatHostGameServerProvider } from './provider.js';
import { connectAddress, renderAddGameServersPanel } from './renderer.js';
import {
  GameServerUpdateThreadService,
  scheduleGameServerUpdateReconcile,
  type UpdateExpiryPayload,
} from './update-thread-service.js';

export interface GameServersModuleDependencies {
  prisma: PrismaClient;
  discord: Client;
  dathost: DatHostServerReader;
  componentSigningSecret: string;
  logger: Logger;
}

export function createGameServersModule(dependencies?: GameServersModuleDependencies): SuiteModule {
  if (dependencies === undefined) {
    return {
      key: 'game-servers',
      displayName: 'Game Servers',
      commands: gameServerCommands,
      componentPrefixes: ['gs:'],
    };
  }

  const cards = new GameServerCardService(
    dependencies.prisma,
    dependencies.discord,
    dependencies.componentSigningSecret,
  );
  const polls = new GameServerPollService(
    dependencies.prisma,
    new DatHostGameServerProvider(dependencies.dathost),
    cards,
  );
  const updates = new GameServerUpdateThreadService(dependencies.prisma, dependencies.discord);

  const handlers = new Map<string, JobHandler>([
    [
      'GAME_SERVER_DATHOST_POLL',
      (job: LeasedJob) => polls.poll((job.payload as { gameServerId: string }).gameServerId),
    ],
    // Legacy compatibility: older deployments may still have one of these jobs queued.
    // The Add Game Servers panel is now ephemeral, so there is nothing persistent to refresh.
    ['GAME_SERVER_PANEL_REFRESH', () => Promise.resolve()],
    [
      'GAME_SERVER_CARD_REFRESH',
      (job: LeasedJob) => cards.refreshCard((job.payload as { cardId: string }).cardId),
    ],
    [
      'GAME_SERVER_UPDATE_NOTIFICATION_EXPIRE',
      (job: LeasedJob) => updates.expireNotification(job.payload as UpdateExpiryPayload),
    ],
    [
      'GAME_SERVER_UPDATE_RECONCILE',
      (job: LeasedJob) => updates.reconcile((job.payload as { gameServerId: string }).gameServerId),
    ],
  ]);

  const report = (operation: Promise<unknown>) => {
    void operation.catch((error: unknown) =>
      dependencies.logger.error(
        { err: error },
        'Game-server update handling failed; check thread permissions and worker retries',
      ),
    );
  };
  const onCreate = (message: ClientEvents['messageCreate'][0]) =>
    report(updates.recordMessage(message));
  const onEdit = (
    _before: ClientEvents['messageUpdate'][0],
    message: ClientEvents['messageUpdate'][1],
  ) => report(updates.recordMessageEdit(message));
  const onDelete = (message: ClientEvents['messageDelete'][0]) =>
    report(updates.handleMessageDelete(message));
  const onBulkDelete = (
    messages: ClientEvents['messageDeleteBulk'][0],
    channel: ClientEvents['messageDeleteBulk'][1],
  ) => report(updates.handleMessagesDelete(channel.id, new Set(messages.keys())));
  const onThreadDelete = (thread: ClientEvents['threadDelete'][0]) =>
    report(updates.handleThreadDelete(thread.id));
  let listening = false;

  return {
    key: 'game-servers',
    displayName: 'Game Servers',
    commands: gameServerCommands,
    componentPrefixes: ['gs:'],
    jobHandlers: handlers,
    handleInteraction: async ({ interaction }) => {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, dependencies);
      } else if (interaction.isMessageComponent()) {
        await handleComponent(interaction, dependencies, cards);
      }
    },
    start: async () => {
      if (!listening) {
        dependencies.discord.on(Events.MessageCreate, onCreate);
        dependencies.discord.on(Events.MessageUpdate, onEdit);
        dependencies.discord.on(Events.MessageDelete, onDelete);
        dependencies.discord.on(Events.MessageBulkDelete, onBulkDelete);
        dependencies.discord.on(Events.ThreadDelete, onThreadDelete);
        listening = true;
      }
      const registrations = await dependencies.prisma.gameServer.findMany({
        where: { enabled: true },
        select: { id: true, public: true, cards: { select: { id: true } } },
      });
      for (const registration of registrations) {
        await scheduleGameServerPoll(dependencies.prisma, registration.id);
        if (registration.public && registration.cards.length > 0)
          await scheduleGameServerUpdateReconcile(dependencies.prisma, registration.id);
      }
    },
    stop: () => {
      dependencies.discord.off(Events.MessageCreate, onCreate);
      dependencies.discord.off(Events.MessageUpdate, onEdit);
      dependencies.discord.off(Events.MessageDelete, onDelete);
      dependencies.discord.off(Events.MessageBulkDelete, onBulkDelete);
      dependencies.discord.off(Events.ThreadDelete, onThreadDelete);
      listening = false;
      return Promise.resolve();
    },
  };
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: GameServersModuleDependencies,
): Promise<void> {
  assertAdministrator(interaction);
  if (interaction.guildId === null) throw new Error('Guild command required');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'setup') {
    const selectedChannel = interaction.options.getChannel('channel', true);
    const channel = await dependencies.discord.channels.fetch(selectedChannel.id);

    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      throw new PublicError('GAME_SERVER_TEXT_CHANNEL_REQUIRED', 'Select a server text channel.');
    }

    assertCardDestinationPermissions(channel, dependencies);

    await dependencies.prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId },
      update: {},
    });

    // The destination channel is durable configuration.
    // The admin picker itself is intentionally ephemeral and has no persistent message ID.
    await dependencies.prisma.gameServerSettings.upsert({
      where: { guildId: interaction.guildId },
      create: {
        guildId: interaction.guildId,
        panelChannelId: channel.id,
        panelMessageId: null,
      },
      update: {
        enabled: true,
        panelChannelId: channel.id,
        panelMessageId: null,
      },
    });

    const servers = await loadAddPanelServers(dependencies.prisma, interaction.guildId);

    await interaction.editReply(
      renderAddGameServersPanel(
        servers,
        dependencies.componentSigningSecret,
        undefined,
        interaction.user.id,
      ),
    );
    return;
  }

  if (subcommand === 'add') {
    await renderDiscovery(
      interaction,
      dependencies,
      interaction.options.getString('display-name', true),
      0,
    );
    return;
  }

  if (subcommand === 'list') {
    const servers = await dependencies.prisma.gameServer.findMany({
      where: { guildId: interaction.guildId },
      include: { snapshot: true },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    await interaction.editReply({
      content:
        servers.length === 0
          ? 'No Game Servers registrations.'
          : servers
              .map(
                (server) =>
                  `\`${server.id}\` — ${server.displayName} — ${server.enabled ? 'enabled' : 'disabled'} / ${server.public ? 'public' : 'private'} — ${server.snapshot?.hostingState ?? 'pending'}`,
              )
              .join('\n'),
    });
    return;
  }

  if (subcommand === 'edit') {
    const id = interaction.options.getString('id', true);
    const existing = await requireRegistration(dependencies.prisma, interaction.guildId, id);
    const displayName = interaction.options.getString('display-name');
    const description = interaction.options.getString('description');
    const enabled = interaction.options.getBoolean('enabled');
    const isPublic = interaction.options.getBoolean('public');
    const connectDomain = interaction.options.getString('connect-domain');
    const joinUrl = interaction.options.getString('join-url');
    const imageUrl = interaction.options.getString('image-url');

    if (joinUrl !== null && !joinUrl.startsWith('https://'))
      throw new Error('Join URL must use HTTPS');
    if (imageUrl !== null && !imageUrl.startsWith('https://'))
      throw new Error('Image URL must use HTTPS');

    const sortOrder = interaction.options.getInteger('sort-order');

    await dependencies.prisma.gameServer.update({
      where: { id: existing.id },
      data: {
        ...(displayName === null ? {} : { displayName }),
        ...(description === null ? {} : { description: description || null }),
        ...(enabled === null ? {} : { enabled }),
        ...(isPublic === null ? {} : { public: isPublic }),
        ...(connectDomain === null ? {} : { connectDomain: connectDomain || null }),
        ...(joinUrl === null ? {} : { joinUrl: joinUrl || null }),
        ...(imageUrl === null ? {} : { imageUrl: imageUrl || null }),
        ...(sortOrder === null ? {} : { sortOrder }),
      },
    });

    if (enabled === true) await scheduleGameServerPoll(dependencies.prisma, existing.id);
    if (enabled === true || isPublic === true)
      await scheduleGameServerUpdateReconcile(dependencies.prisma, existing.id);
    await interaction.editReply('Game Server registration updated.');
    return;
  }

  if (subcommand === 'remove') {
    const registration = await requireRegistration(
      dependencies.prisma,
      interaction.guildId,
      interaction.options.getString('id', true),
    );
    await dependencies.prisma.gameServer.delete({ where: { id: registration.id } });
    await interaction.editReply(
      'Local Game Server registration removed. The DatHost server was not modified.',
    );
    return;
  }

  if (subcommand === 'test') {
    const registration = await requireRegistration(
      dependencies.prisma,
      interaction.guildId,
      interaction.options.getString('id', true),
    );
    const server = await dependencies.dathost.getServer(registration.providerServerId);
    if (server === null) throw new Error('DatHost server is inaccessible');

    const now = new Date();
    const metrics = await dependencies.dathost
      .getCsMonitoringMetrics(
        registration.providerServerId,
        new Date(now.getTime() - 2 * 60_000),
        now,
      )
      .catch(() => null);

    await interaction.editReply({
      content: [
        `DatHost read test passed for **${registration.displayName}**.`,
        `Game: ${server.game ?? 'unknown'}`,
        `State: ${server.on === false ? 'stopped' : server.booting ? 'starting' : 'running'}`,
        `Address available: ${server.ip === undefined ? 'no' : 'yes'}`,
        `Monitoring available: ${metrics === null ? 'no' : 'yes'}`,
      ].join('\n'),
    });
    return;
  }

  if (subcommand === 'diagnostics') {
    const registrations = await dependencies.prisma.gameServer.findMany({
      where: { guildId: interaction.guildId },
      include: { snapshot: true },
      orderBy: { displayName: 'asc' },
    });

    const lines = await Promise.all(
      registrations.map(async (registration) => {
        const accessible = await dependencies.dathost
          .getServer(registration.providerServerId)
          .then((server) => server !== null)
          .catch(() => false);
        return `${registration.displayName}: ${registration.enabled ? 'enabled' : 'disabled'}, ${registration.public ? 'public' : 'private'}, provider ${accessible ? 'reachable' : 'unreachable'}, snapshot ${registration.snapshot === null ? 'missing' : registration.snapshot.stale ? 'stale' : 'current'}`;
      }),
    );

    await interaction.editReply({ content: lines.join('\n') || 'No registrations to diagnose.' });
  }
}

async function handleComponent(
  interaction: MessageComponentInteraction,
  dependencies: GameServersModuleDependencies,
  cards: GameServerCardService,
): Promise<void> {
  if (interaction.guildId === null) throw new Error('Guild interaction required');

  const payload = parseGameServerCustomId(
    interaction.customId,
    dependencies.componentSigningSecret,
    interaction.user.id,
  );

  if (payload.action === 'select' && interaction.isStringSelectMenu()) {
    assertAdministrator(interaction);

    const gameServerId = interaction.values[0];
    if (gameServerId === undefined) throw new Error('Game Server selection is required');

    await interaction.deferUpdate();

    const servers = await loadAddPanelServers(dependencies.prisma, interaction.guildId);

    await interaction.editReply(
      renderAddGameServersPanel(
        servers,
        dependencies.componentSigningSecret,
        gameServerId,
        interaction.user.id,
      ),
    );
    return;
  }

  if (payload.action === 'add') {
    assertAdministrator(interaction);
    await interaction.deferUpdate();

    const gameServerId = payload.value;
    if (gameServerId === undefined) {
      await interaction.editReply('Select a server before pressing Add Server.');
      return;
    }

    const settings = await dependencies.prisma.gameServerSettings.findUnique({
      where: { guildId: interaction.guildId },
    });

    if (settings?.panelChannelId === null || settings?.panelChannelId === undefined) {
      await interaction.editReply(
        'No server-card destination is configured. Run `/servers admin setup` again.',
      );
      return;
    }

    const channel = await dependencies.discord.channels
      .fetch(settings.panelChannelId)
      .catch(() => null);

    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.editReply(
        'The configured server-card destination is unavailable. Run `/servers admin setup` again.',
      );
      return;
    }

    try {
      assertCardDestinationPermissions(channel, dependencies);
      await cards.createCard(gameServerId, channel);
      await scheduleGameServerUpdateReconcile(dependencies.prisma, gameServerId);
    } catch (error: unknown) {
      if (error instanceof PublicError) {
        await interaction.editReply(error.message);
        return;
      }
      throw error;
    }

    // The setup UI is an ephemeral interaction response. Once the persistent
    // server card has been posted successfully, remove the admin-only picker.
    await interaction.deleteReply();
    return;
  }

  if (payload.action === 'connect') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (payload.value === undefined) {
      await interaction.editReply('Server connection information is unavailable.');
      return;
    }

    const server = await dependencies.prisma.gameServer.findFirst({
      where: { id: payload.value, guildId: interaction.guildId },
      include: { snapshot: true },
    });

    if (server === null) {
      await interaction.editReply('Server registration not found.');
      return;
    }

    const address = connectAddress(server);
    const lines = [`**${server.displayName}**`];

    if (server.joinUrl !== null) {
      lines.push(`Connect: ${server.joinUrl}`);
    }
    if (address !== null) {
      lines.push(`Console address: \`${address}\``);
      lines.push(`Open the CS2 developer console and run:\n\`connect ${address}\``);
    }
    if (server.joinUrl === null && address === null) {
      lines.push('No connection address is configured for this server.');
    }

    await interaction.editReply(lines.join('\n'));
    return;
  }

  if (payload.action === 'map-rules') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (payload.value === undefined) {
      await interaction.editReply('Server map and rules information is unavailable.');
      return;
    }

    const server = await dependencies.prisma.gameServer.findFirst({
      where: { id: payload.value, guildId: interaction.guildId },
      include: { snapshot: true },
    });

    if (server === null) {
      await interaction.editReply('Server registration not found.');
      return;
    }

    const lines = [
      `**${server.displayName}**`,
      '',
      `**Current Map**\n${server.snapshot?.map ?? 'Unknown'}`,
    ];

    if (server.description !== null && server.description.trim().length > 0) {
      lines.push('', `**Rules**\n${server.description}`);
    } else {
      lines.push('', 'No server rules are configured.');
    }

    await interaction.editReply(lines.join('\n'));
    return;
  }

  if (payload.action === 'copy-address') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (payload.value === undefined) {
      await interaction.editReply('Server address information is unavailable.');
      return;
    }

    const server = await dependencies.prisma.gameServer.findFirst({
      where: { id: payload.value, guildId: interaction.guildId },
      include: { snapshot: true },
    });

    if (server === null) {
      await interaction.editReply('Server registration not found.');
      return;
    }

    const address = connectAddress(server);
    if (address === null) {
      await interaction.editReply('No connect address is configured for this server.');
      return;
    }

    await interaction.editReply(`**${server.displayName}**\n\`${address}\``);
    return;
  }

  assertAdministrator(interaction);

  if (payload.action === 'page') {
    if (payload.name === undefined || payload.value === undefined)
      throw new Error('Invalid discovery page');

    const page = Number.parseInt(payload.value, 10);
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid discovery page');

    await interaction.deferUpdate();
    await renderDiscovery(interaction, dependencies, payload.name, page);
    return;
  }

  if (payload.action === 'discover') {
    if (!interaction.isStringSelectMenu()) throw new Error('Invalid discovery control');

    const providerServerId = interaction.values[0];
    if (providerServerId === undefined || payload.name === undefined)
      throw new Error('Invalid DatHost selection');

    await interaction.deferUpdate();

    const server = await dependencies.dathost.getServer(providerServerId);
    if (server === null || !isSupportedCs2(server.game))
      throw new Error('Unsupported DatHost server');

    await interaction.editReply({
      content: [
        '**Confirm DatHost Server**',
        server.name,
        `Location: ${server.location ?? 'unknown'}`,
        `Address: ${server.ip ?? 'pending'}${server.ports?.game === undefined ? '' : `:${String(server.ports.game)}`}`,
        `State: ${server.on === false ? 'Stopped' : server.booting ? 'Starting' : 'Running'}`,
      ].join('\n'),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              createGameServerCustomId(
                {
                  action: 'confirm',
                  value: providerServerId,
                  name: payload.name,
                  ownerId: interaction.user.id,
                },
                dependencies.componentSigningSecret,
              ),
            )
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(
              createGameServerCustomId(
                { action: 'cancel', ownerId: interaction.user.id },
                dependencies.componentSigningSecret,
              ),
            )
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  if (payload.action === 'confirm') {
    if (payload.value === undefined || payload.name === undefined)
      throw new Error('Invalid confirmation');

    await interaction.deferUpdate();

    const server = await dependencies.dathost.getServer(payload.value);
    if (server === null || !isSupportedCs2(server.game))
      throw new Error('Unsupported DatHost server');

    await dependencies.prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      create: { guildId: interaction.guildId },
      update: {},
    });

    const registration = await dependencies.prisma.gameServer.create({
      data: {
        guildId: interaction.guildId,
        providerServerId: server.id,
        displayName: payload.name,
      },
    });

    await scheduleGameServerPoll(dependencies.prisma, registration.id);

    await interaction.editReply({
      content: `DatHost Server Added: **${payload.name}**`,
      components: [],
    });
    return;
  }

  if (payload.action === 'cancel') {
    await interaction.update({ content: 'DatHost server addition canceled.', components: [] });
  }
}

async function loadAddPanelServers(prisma: PrismaClient, guildId: string) {
  const servers = await prisma.gameServer.findMany({
    where: { guildId, enabled: true, public: true },
    include: { snapshot: true, cards: { select: { id: true } } },
    orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
  });

  return servers.map((server) => ({
    ...server,
    hasCard: server.cards.length > 0,
  }));
}

function assertCardDestinationPermissions(
  channel: GuildTextBasedChannel,
  dependencies: GameServersModuleDependencies,
): void {
  const botUser = dependencies.discord.user;
  if (botUser === null) throw new Error('Discord client is not ready');

  const permissions = channel.permissionsFor(botUser);
  const requiredPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  if (permissions?.has(requiredPermissions) !== true) {
    throw new PublicError(
      'GAME_SERVER_PANEL_MISSING_PERMISSIONS',
      'I need View Channel, Send Messages, Embed Links, and Read Message History permissions in that channel before I can create server cards there.',
    );
  }
}

async function renderDiscovery(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  dependencies: GameServersModuleDependencies,
  displayName: string,
  page: number,
): Promise<void> {
  const [inventory, attached] = await Promise.all([
    dependencies.dathost.listServers(),
    dependencies.prisma.gameServer.findMany({
      where: { guildId: interaction.guildId ?? '' },
      select: { providerServerId: true },
    }),
  ]);

  const attachedIds = new Set(attached.map((server) => server.providerServerId));
  const available = inventory.filter(
    (server) => isSupportedCs2(server.game) && !attachedIds.has(server.id),
  );
  const options = available.slice(page * 25, page * 25 + 25);

  if (options.length === 0) {
    await interaction.editReply('No unregistered DatHost CS2 servers are available.');
    return;
  }

  await interaction.editReply({
    content: 'Select a DatHost CS2 server:',
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            createGameServerCustomId(
              { action: 'discover', name: displayName, ownerId: interaction.user.id },
              dependencies.componentSigningSecret,
            ),
          )
          .setPlaceholder('Select a DatHost CS2 server')
          .addOptions(
            options.map((server) => ({
              label: server.name.slice(0, 100),
              description: (server.location ?? server.id).slice(0, 100),
              value: server.id,
            })),
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createGameServerCustomId(
              {
                action: 'page',
                value: String(Math.max(0, page - 1)),
                name: displayName,
                ownerId: interaction.user.id,
              },
              dependencies.componentSigningSecret,
            ),
          )
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(
            createGameServerCustomId(
              {
                action: 'page',
                value: String(page + 1),
                name: displayName,
                ownerId: interaction.user.id,
              },
              dependencies.componentSigningSecret,
            ),
          )
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled((page + 1) * 25 >= available.length),
      ),
    ],
  });
}

function assertAdministrator(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
): void {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) !== true)
    throw new Error('Administrator permission required');
}

function isSupportedCs2(game: string | null | undefined): boolean {
  return game === 'cs2' || game === 'csgo';
}

async function requireRegistration(prisma: PrismaClient, guildId: string, id: string) {
  const registration = await prisma.gameServer.findFirst({ where: { id, guildId } });
  if (registration === null) throw new Error('Game Server registration not found');
  return registration;
}
