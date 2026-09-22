import {
  Client,
  Events,
  GatewayIntentBits,
  GuildMemberRoleManager,
  PermissionFlagsBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import type { PrismaClient, TenManSettings } from '../generated/prisma/client.js';
import type { MatchService } from '../modules/tenman/services/match-service.js';
import type { SteamLinkService } from '../modules/tenman/services/steam-link-service.js';
import { GuildSettingsService } from '../modules/tenman/services/guild-settings-service.js';
import type { DatHostClient } from '../modules/tenman/integrations/dathost/client.js';
import { DiagnosticsService } from '../modules/tenman/services/diagnostics-service.js';
import { commands } from '../modules/tenman/bot/commands.js';
import { assertAuthorized, type ActorContext } from '../modules/tenman/domain/authorization.js';
import type { Logger } from 'pino';
import { PublicError, publicMessage } from '../errors/public-error.js';
import {
  GuildResourceService,
  type ManagedPreview,
} from '../modules/tenman/services/guild-resource-service.js';
import { adminGeneration } from '../modules/tenman/bot/admin-custom-id.js';
import { buildAdminConfirmationControls } from '../modules/tenman/bot/admin-components.js';
import { ModuleRegistry } from '../core/modules/registry.js';
import { createTenManModule } from '../modules/tenman/module.js';
import { RewardService } from '../modules/rewards/services/reward-service.js';
import { TextActivityService } from '../modules/rewards/services/text-activity-service.js';
import { createRewardsModule } from '../modules/rewards/module.js';
import { LevelRoleService } from '../modules/rewards/services/level-role-service.js';
import { VoiceActivityService } from '../modules/rewards/services/voice-activity-service.js';
import { TagLoyaltyService } from '../modules/rewards/services/tag-loyalty-service.js';
import { QueuePanelService } from '../modules/tenman/services/queue-panel-service.js';
import { TenManComponentInteractionRouter } from '../modules/tenman/bot/interaction-router.js';
import { MatchHistoryService } from '../modules/tenman/services/match-history-service.js';
import { QueueBanService } from '../modules/tenman/services/queue-ban-service.js';
import {
  buildCancelMatchConfirmationControls,
  buildRestartPhaseConfirmationControls,
  buildRollbackConfirmationControls,
} from '../modules/tenman/bot/match-admin-components.js';
import { PartyService } from '../modules/tenman/services/party-service.js';
import { MatchAdminService } from '../modules/tenman/services/match-admin-service.js';
import { buildPlayerStatsResetConfirmationControls } from '../modules/tenman/bot/player-admin-components.js';
import type { CredentialCipher } from '../modules/tenman/services/credential-cipher.js';
import { MatchParticipantInfoService } from '../modules/tenman/services/match-participant-info-service.js';

export interface BotDependencies {
  token: string;
  clientId: string;
  prisma: PrismaClient;
  matchService: MatchService;
  steamLinkService: SteamLinkService;
  dathost: DatHostClient;
  componentSigningSecret: string;
  credentialCipher: CredentialCipher;
  logger: Logger;
}

export async function registerCommands(
  token: string,
  clientId: string,
  commandBody: readonly unknown[] = commands,
): Promise<void> {
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commandBody });
}

export function createDiscordClient(dependencies: BotDependencies): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const rewardService = new RewardService(dependencies.prisma);
  const textActivity = new TextActivityService(dependencies.prisma, rewardService);
  const levelRoles = new LevelRoleService(dependencies.prisma, client);
  const voiceActivity = new VoiceActivityService(dependencies.prisma, rewardService, levelRoles);
  const tagLoyalty = new TagLoyaltyService(dependencies.prisma, client, dependencies.logger);
  client.on(Events.MessageCreate, (message) => {
    if (message.guildId === null || message.author.bot || message.webhookId !== null) return;
    void textActivity
      .record({
        guildId: message.guildId,
        channelId: message.channelId,
        discordUserId: message.author.id,
        displayName:
          message.member?.displayName ?? message.author.globalName ?? message.author.username,
        messageId: message.id,
        occurredAt: message.createdAt,
      })
      .then(async (result) => {
        if (result?.applied === true) {
          await levelRoles.reconcile(message.guildId ?? '', message.author.id);
        }
      })
      .catch((error: unknown) => {
        dependencies.logger.error(
          { err: error, guildId: message.guildId, userId: message.author.id },
          'Reward text activity failed',
        );
      });
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (member === null || member.user.bot) return;
    void voiceActivity
      .observe({
        guildId: newState.guild.id,
        discordUserId: member.id,
        displayName: member.displayName,
        channelId: newState.channelId,
        observedAt: new Date(),
      })
      .catch((error: unknown) => {
        dependencies.logger.error(
          { err: error, guildId: newState.guild.id, userId: member.id },
          'Reward voice activity failed',
        );
      });
  });
  client.on(Events.GuildMemberUpdate, (_oldMember, member) => {
    const primaryGuild = member.user.primaryGuild;
    void tagLoyalty
      .observe(
        member.guild.id,
        member,
        primaryGuild?.identityEnabled === true && primaryGuild.identityGuildId === member.guild.id,
      )
      .catch((error: unknown) => {
        dependencies.logger.error(
          { err: error, guildId: member.guild.id, userId: member.id },
          'Reward guild-tag update failed',
        );
      });
  });
  client.on(Events.UserUpdate, (_oldUser, user) => {
    for (const guild of client.guilds.cache.values()) {
      const member = guild.members.cache.get(user.id);
      if (member === undefined) continue;
      void tagLoyalty
        .observe(
          guild.id,
          member,
          user.primaryGuild?.identityEnabled === true &&
            user.primaryGuild.identityGuildId === guild.id,
        )
        .catch((error: unknown) => {
          dependencies.logger.error(
            { err: error, guildId: guild.id, userId: user.id },
            'Reward guild-tag update failed',
          );
        });
    }
  });
  const guildSettingsService = new GuildSettingsService(dependencies.prisma, client);
  const guildResourceService = new GuildResourceService(
    dependencies.prisma,
    client,
    dependencies.logger,
  );
  const tenManComponentRouter = new TenManComponentInteractionRouter({
    prisma: dependencies.prisma,
    componentSigningSecret: dependencies.componentSigningSecret,
    actorFor: (interaction, matchId) =>
      createActorContext(interaction, matchId, dependencies.prisma),
    adminActorFor: (interaction) => createGuildAdminActor(interaction, dependencies.prisma),
    guildResourceService,
    matchService: dependencies.matchService,
    participantInfo: new MatchParticipantInfoService(
      dependencies.prisma,
      dependencies.credentialCipher,
    ),
  });
  const modules = new ModuleRegistry([
    {
      ...createTenManModule(),
      handleInteraction: async ({ interaction }) => {
        if (interaction.isChatInputCommand()) {
          await handleCommand(
            interaction,
            dependencies,
            client,
            guildSettingsService,
            guildResourceService,
          );
        } else {
          await tenManComponentRouter.handle(interaction);
        }
      },
    },
    createRewardsModule({
      prisma: dependencies.prisma,
      logger: dependencies.logger,
      componentSigningSecret: dependencies.componentSigningSecret,
    }),
  ]);
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isMessageComponent()) return;
    const operation = modules.dispatch(interaction).then(async (handled) => {
      if (!handled)
        await interaction.reply({ content: 'Unknown module interaction.', ephemeral: true });
    });
    void operation.catch(async (error: unknown) => {
      dependencies.logger.error(
        {
          err: error,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        },
        'Discord interaction failed',
      );
      const content = publicMessage(error, interaction.id);
      if (interaction.deferred) {
        await interaction.editReply({ content, components: [] }).catch(() => undefined);
      } else if (interaction.replied) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
      }
    });
  });
  return client;
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: BotDependencies,
  client: Client,
  guildSettingsService: GuildSettingsService,
  guildResourceService: GuildResourceService,
): Promise<void> {
  if (interaction.guildId === null) throw new Error('Guild command required');
  await interaction.deferReply({ ephemeral: true });
  if (TENMAN_COMMAND_NAMES.has(interaction.commandName) && !isTenManSetupCommand(interaction)) {
    const settings = await dependencies.prisma.tenManSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    if (!isManagedTenManCommandChannel(interaction.channelId, settings))
      throw new PublicError(
        'TENMAN_MANAGED_CHANNEL_REQUIRED',
        'Use 10man commands in an active bot-managed 10man channel.',
      );
  }
  if (
    interaction.commandName === 'steam' &&
    ['register', 'replace'].includes(interaction.options.getSubcommand())
  ) {
    const challenge = await dependencies.steamLinkService.createChallenge(interaction.user.id);
    await interaction.editReply({
      content: `Verify Steam ownership: ${challenge.startUrl.toString()}`,
    });
    return;
  }
  if (interaction.commandName === 'steam' && interaction.options.getSubcommand() === 'status') {
    const identity = await dependencies.prisma.steamIdentity.findFirst({
      where: { discordUserId: interaction.user.id, invalidatedAt: null },
      select: { steamId64: true, verifiedAt: true },
    });
    await interaction.editReply({
      content:
        identity === null
          ? 'No verified Steam account.'
          : `Verified SteamID64: ${identity.steamId64}`,
    });
    return;
  }
  if (interaction.commandName === '10man' && interaction.options.getSubcommand() === 'queue') {
    const settings = await dependencies.prisma.tenManSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    if (settings === null || !settings.enabled) {
      throw new Error('10man is not enabled for this server');
    }
    const roles = interaction.member?.roles;
    const memberRoles =
      roles === undefined
        ? []
        : roles instanceof GuildMemberRoleManager
          ? [...roles.cache.keys()]
          : roles;
    if (
      !memberRoles.some((role) =>
        [...settings.moderatorRoleIds, ...settings.administratorRoleIds].includes(role),
      ) &&
      !(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false)
    ) {
      throw new Error('Moderator role required');
    }
    if (settings.lobbyTextChannelId === null)
      throw new Error('Lobby text channel is not configured');
    const channel = await client.channels.fetch(settings.lobbyTextChannelId);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error('Configured lobby text channel is unavailable');
    }
    await dependencies.prisma.tenManQueue.upsert({
      where: { guildId: interaction.guildId },
      update: {},
      create: { guildId: interaction.guildId },
    });
    await new QueuePanelService(
      dependencies.prisma,
      client,
      dependencies.componentSigningSecret,
    ).reconcile(interaction.guildId, channel);
    await interaction.editReply({ content: `10man queue panel is ready in <#${channel.id}>.` });
    return;
  }
  if (interaction.commandName === '10man' && interaction.options.getSubcommand() === 'cancel') {
    const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
    if (match === null) throw new Error('No active match');
    const actor = await createActorContext(interaction, match.id, dependencies.prisma);
    assertAuthorized('STOP', actor, match);
    await interaction.editReply({
      content: `This cancels match ${match.id.slice(0, 8)} and starts cleanup if needed. Confirm within five minutes.`,
      components: buildCancelMatchConfirmationControls(
        {
          matchId: match.id,
          version: match.version,
          phaseGeneration: match.phaseGeneration,
          actorDiscordUserId: interaction.user.id,
          expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
        },
        dependencies.componentSigningSecret,
      ),
    });
    return;
  }
  if (interaction.commandName === '10man' && interaction.options.getSubcommand() === 'status') {
    const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
    if (match === null) {
      await interaction.editReply({ content: 'There is no active 10man.' });
      return;
    }
    await interaction.editReply({
      content:
        `Active match ${match.id.slice(0, 8)}: ${match.state}. ` +
        `Map: ${match.selectedMap ?? 'pending'}; ` +
        `players: ${String(match.players.length)}; ` +
        `ready: ${String(match.players.filter((player) => player.readyState === 'READY').length)}.`,
    });
    return;
  }
  if (interaction.commandName === 'player') {
    const target = interaction.options.getUser('player') ?? interaction.user;
    if (interaction.options.getSubcommand() === 'stats') {
      const stats = await dependencies.prisma.playerGuildStats.findUnique({
        where: {
          guildId_discordUserId: { guildId: interaction.guildId, discordUserId: target.id },
        },
      });
      if (stats === null) {
        await interaction.editReply({ content: `<@${target.id}> has no match statistics yet.` });
        return;
      }
      await interaction.editReply({
        content: `<@${target.id}> — rating: **${String(stats.rating)}**; record: **${String(stats.wins)}–${String(stats.losses)}**; matches: **${String(stats.matchesPlayed)}**.`,
      });
      return;
    }
    const history = await new MatchHistoryService(dependencies.prisma).recentMatches(
      interaction.guildId,
      target.id,
    );
    await interaction.editReply({
      content: formatRecentMatches(target.id, history),
    });
    return;
  }
  if (interaction.commandName === 'party') {
    const partyService = new PartyService(dependencies.prisma);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'create') {
      const partyId = await partyService.create(interaction.guildId, interaction.user.id);
      await interaction.editReply({ content: `Party created. Party ID: \`${partyId}\`` });
      return;
    }
    if (subcommand === 'invite') {
      const partyId = interaction.options.getString('party_id', true);
      const target = interaction.options.getUser('player', true);
      const inviteId = await partyService.invite(partyId, interaction.user.id, target.id);
      const message = `You have a 10man party invitation from <@${interaction.user.id}>. Accept it with \`/party accept invite_id:${inviteId}\` within 15 minutes.`;
      const delivered = await target
        .send(message)
        .then(() => true)
        .catch(() => false);
      await interaction.editReply({
        content: delivered
          ? `Invitation sent to <@${target.id}>.`
          : `Invitation created for <@${target.id}>. Their DMs are unavailable; give them this invitation ID: \`${inviteId}\`.`,
      });
      return;
    }
    if (subcommand === 'accept') {
      await partyService.accept(
        interaction.options.getString('invite_id', true),
        interaction.user.id,
      );
      await interaction.editReply({ content: 'Party invitation accepted.' });
      return;
    }
    const partyId = interaction.options.getString('party_id', true);
    if (subcommand === 'leave') {
      await partyService.leave(partyId, interaction.user.id);
      await interaction.editReply({ content: 'You left the party.' });
      return;
    }
    if (subcommand === 'kick') {
      const target = interaction.options.getUser('player', true);
      await partyService.kick(partyId, interaction.user.id, target.id);
      await interaction.editReply({ content: `<@${target.id}> was removed from the party.` });
      return;
    }
    if (subcommand === 'disband') {
      await partyService.disband(partyId, interaction.user.id);
      await interaction.editReply({ content: 'Party disbanded.' });
      return;
    }
  }
  if (interaction.commandName === 'match') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'history') {
      const target = interaction.options.getUser('player') ?? interaction.user;
      const history = await new MatchHistoryService(dependencies.prisma).recentMatches(
        interaction.guildId,
        target.id,
      );
      await interaction.editReply({ content: formatRecentMatches(target.id, history) });
      return;
    }
  }

  if (interaction.commandName === 'match' && interaction.options.getSubcommandGroup() === 'admin') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'status') {
      const settings = await dependencies.prisma.tenManSettings.findUnique({
        where: { guildId: interaction.guildId },
      });
      if (settings === null) {
        await interaction.editReply({
          content: 'This server is not configured. Use `/match admin configure`.',
        });
        return;
      }
      await interaction.editReply({
        content:
          `10man configured: ${settings.enabled ? 'enabled' : 'disabled'}\n` +
          `Template: ${settings.dathostTemplateServerId ?? 'unset'}\n` +
          `Location: ${settings.defaultServerLocation ?? 'unset'}\n` +
          `Profile: ${settings.defaultGameProfileKey ?? 'unset'}\n` +
          `Queue: ${String(settings.queueSize)} players\n` +
          `Ready timeout: ${String(settings.readyTimeoutSeconds)}s; parties: ${settings.partyEnabled ? 'enabled' : 'disabled'}\n` +
          `Selection: ${settings.teamSelectionMode} teams; ${settings.mapSelectionMode} maps\n` +
          `Managed resources: ${settings.managedResourceState}${settings.managedSetupStep === null ? '' : ` (${settings.managedSetupStep})`}`,
      });
      return;
    }
    if (subcommand === 'setup') {
      const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('SETUP_GUILD', adminActor);
      const result = await guildResourceService.setup({
        guildId: interaction.guildId,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
        ...(interaction.options.getRole('privileged_role')?.id === undefined
          ? {}
          : { privilegedRoleId: interaction.options.getRole('privileged_role', true).id }),
        ...(interaction.options.getRole('moderator_role')?.id === undefined
          ? {}
          : { moderatorRoleId: interaction.options.getRole('moderator_role', true).id }),
        ...(interaction.options.getRole('administrator_role')?.id === undefined
          ? {}
          : { administratorRoleId: interaction.options.getRole('administrator_role', true).id }),
        ...(interaction.options.getString('dathost_template_server_id') === null
          ? {}
          : {
              dathostTemplateServerId: interaction.options.getString(
                'dathost_template_server_id',
                true,
              ),
            }),
        ...(interaction.options.getString('dathost_location') === null
          ? {}
          : { defaultServerLocation: interaction.options.getString('dathost_location', true) }),
        ...(interaction.options.getString('default_game_profile') === null
          ? {}
          : {
              defaultGameProfileKey: interaction.options.getString('default_game_profile', true),
            }),
      });
      await interaction.editReply({
        content: `Managed 10man channels created in <#${result.categoryId ?? ''}>. Run \`/match admin diagnostics\` to verify setup.`,
      });
      return;
    }
    if (subcommand === 'disable') {
      const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('DISABLE_GUILD', adminActor);
      const changed = await guildResourceService.disable(
        interaction.guildId,
        interaction.user.id,
        interaction.id,
      );
      await interaction.editReply({
        content: changed ? 'New 10man creation is disabled.' : 'This server is already disabled.',
      });
      return;
    }
    if (subcommand === 'enable') {
      const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('ENABLE_GUILD', adminActor);
      const changed = await guildResourceService.enable(
        interaction.guildId,
        interaction.user.id,
        interaction.id,
      );
      await interaction.editReply({
        content: changed ? '10man creation is enabled.' : 'This server is already enabled.',
      });
      return;
    }
    if (subcommand === 'teardown' || subcommand === 'recover-setup') {
      const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized(
        subcommand === 'teardown' ? 'TEARDOWN_GUILD' : 'RECOVER_GUILD_SETUP',
        adminActor,
      );
      const preview =
        subcommand === 'teardown'
          ? await guildResourceService.teardownPreview(interaction.guildId)
          : await guildResourceService.recoverPreview(interaction.guildId);
      const generation = adminGeneration(preview.attemptId, preview.settingsVersion);
      await interaction.editReply({
        content: formatManagedPreview(preview, subcommand === 'teardown'),
        components: buildAdminConfirmationControls(
          {
            guildId: interaction.guildId,
            actorDiscordUserId: interaction.user.id,
            settingsVersion: preview.settingsVersion,
            generation,
            expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
          },
          dependencies.componentSigningSecret,
          subcommand === 'teardown' ? 'teardown' : 'recovery',
        ),
      });
      return;
    }
    if (subcommand === 'configure') {
      const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('CONFIGURE_GUILD', adminActor);
      const lobbyTextChannel = interaction.options.getChannel('lobby_text_channel', true);
      const lobbyVoiceChannel = interaction.options.getChannel('lobby_voice_channel', true);
      const team1VoiceChannel = interaction.options.getChannel('team1_voice_channel', true);
      const team2VoiceChannel = interaction.options.getChannel('team2_voice_channel', true);
      const resultsChannel = interaction.options.getChannel('results_channel');
      const privilegedRole = interaction.options.getRole('privileged_role', true);
      const moderatorRole = interaction.options.getRole('moderator_role', true);
      const administratorRole = interaction.options.getRole('administrator_role', true);
      const defaultServerLocation = interaction.options.getString('dathost_location') ?? undefined;
      const defaultGameProfileKey =
        interaction.options.getString('default_game_profile') ?? undefined;
      const queueSize = interaction.options.getInteger('queue_size') ?? undefined;
      const readyTimeoutSeconds =
        interaction.options.getInteger('ready_timeout_seconds') ?? undefined;
      const partyEnabled = interaction.options.getBoolean('party_enabled') ?? undefined;
      const configuredTeamSelectionMode = interaction.options.getString('team_selection');
      const teamSelectionMode =
        configuredTeamSelectionMode === 'CAPTAINS' || configuredTeamSelectionMode === 'RANDOM'
          ? configuredTeamSelectionMode
          : undefined;
      const configuredMapSelectionMode = interaction.options.getString('map_selection');
      const mapSelectionMode =
        configuredMapSelectionMode === 'CAPTAIN_VETO' || configuredMapSelectionMode === 'RANDOM'
          ? configuredMapSelectionMode
          : undefined;
      await guildSettingsService.update({
        guildId: interaction.guildId,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
        lobbyTextChannelId: lobbyTextChannel.id,
        lobbyVoiceChannelId: lobbyVoiceChannel.id,
        team1VoiceChannelId: team1VoiceChannel.id,
        team2VoiceChannelId: team2VoiceChannel.id,
        ...(resultsChannel === null ? {} : { resultsChannelId: resultsChannel.id }),
        privilegedRoleIds: [privilegedRole.id],
        moderatorRoleIds: [moderatorRole.id],
        administratorRoleIds: [administratorRole.id],
        dathostTemplateServerId: interaction.options.getString('dathost_template_server_id', true),
        ...(defaultServerLocation === undefined ? {} : { defaultServerLocation }),
        ...(defaultGameProfileKey === undefined ? {} : { defaultGameProfileKey }),
        ...(queueSize === undefined ? {} : { queueSize }),
        ...(readyTimeoutSeconds === undefined ? {} : { readyTimeoutSeconds }),
        ...(partyEnabled === undefined ? {} : { partyEnabled }),
        ...(teamSelectionMode === undefined ? {} : { teamSelectionMode }),
        ...(mapSelectionMode === undefined ? {} : { mapSelectionMode }),
      });
      await interaction.editReply({ content: '10man configuration saved.' });
      return;
    }
    if (subcommand === 'diagnostics') {
      const adminActor = await createActorContext(interaction, '', dependencies.prisma);
      assertAuthorized('DIAGNOSTICS', adminActor);
      const report = await new DiagnosticsService(
        dependencies.prisma,
        client,
        dependencies.dathost,
      ).runGuildDiagnostics(interaction.guildId);
      await interaction.editReply({ content: formatDiagnosticsReport(report) });
      return;
    }
    if (subcommand === 'panel') {
      const active = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (active === null) throw new Error('No active match');
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('VIEW_ADMIN', actor);
      const match = await dependencies.prisma.match.findUnique({
        where: { id: active.id },
        include: { players: true, draftPicks: true, vetoActions: true, discordResources: true },
      });
      if (match === null) throw new Error('Match is no longer active');
      const captains = match.players
        .filter((player) => player.captainTeam !== null)
        .map(
          (player) =>
            `${player.captainTeam === 'TEAM_1' ? 'Team 1' : 'Team 2'} <@${player.discordUserId}>`,
        )
        .join('; ');
      const resources = match.discordResources
        .map((resource) => `${resource.resourceType}: ${resource.state}`)
        .join('; ');
      await interaction.editReply({
        embeds: [
          {
            title: `MATCH ${match.id.slice(0, 8)} — ADMIN`,
            fields: [
              { name: 'State', value: match.state, inline: true },
              {
                name: 'Players',
                value: `${String(match.players.length)}; ready ${String(match.players.filter((player) => player.readyState === 'READY').length)}`,
                inline: true,
              },
              { name: 'Map', value: match.selectedMap ?? 'Pending', inline: true },
              { name: 'Captains', value: captains || 'Pending' },
              {
                name: 'Draft / veto',
                value: `${String(match.draftPicks.length)} picks; ${String(match.vetoActions.length)} veto actions`,
              },
              { name: 'Resources', value: resources || 'Pending' },
            ],
            footer: {
              text: `Version ${String(match.version)} · Phase generation ${String(match.phaseGeneration)}`,
            },
          },
        ],
      });
      return;
    }
    if (subcommand === 'force-ready') {
      const active = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (active === null) throw new Error('No active match');
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('FORCE_READY', actor);
      await new MatchAdminService(dependencies.prisma).forceReady(
        active.id,
        active.version,
        interaction.user.id,
        interaction.id,
      );
      await interaction.editReply({ content: 'Ready check was forced forward to team selection.' });
      return;
    }
    if (subcommand === 'restart-phase') {
      const active = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (active === null) throw new Error('No active match');
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('RESTART_PHASE', actor);
      if (!['READY_CHECK', 'TEAM_SELECTION', 'MAP_VETO'].includes(active.state))
        throw new Error('The active match is not in a restartable forming phase.');
      await interaction.editReply({
        content: `This clears the current ${active.state.toLowerCase().replaceAll('_', ' ')} progress. Confirm within five minutes.`,
        components: buildRestartPhaseConfirmationControls(
          {
            matchId: active.id,
            version: active.version,
            phaseGeneration: active.phaseGeneration,
            actorDiscordUserId: interaction.user.id,
            expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
          },
          dependencies.componentSigningSecret,
        ),
      });
      return;
    }
    if (subcommand === 'reset-player-stats') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('RESET_PLAYER_STATS', actor);
      const target = interaction.options.getUser('player', true);
      await interaction.editReply({
        content: `This resets <@${target.id}>'s current rating and record. Match history is retained. Confirm within five minutes.`,
        components: buildPlayerStatsResetConfirmationControls(
          {
            guildId: interaction.guildId,
            targetDiscordUserId: target.id,
            actorDiscordUserId: interaction.user.id,
            expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
          },
          dependencies.componentSigningSecret,
        ),
      });
      return;
    }
    if (subcommand === 'replace-player') {
      const active = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (active === null) throw new Error('No active match');
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('REPLACE_PARTICIPANT', actor);
      const outgoing = interaction.options.getUser('outgoing', true);
      const incoming = interaction.options.getUser('incoming', true);
      await new MatchAdminService(dependencies.prisma).replaceParticipant({
        matchId: active.id,
        outgoingDiscordUserId: outgoing.id,
        incomingDiscordUserId: incoming.id,
        expectedVersion: active.version,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
      await interaction.editReply({
        content: `Replaced <@${outgoing.id}> with <@${incoming.id}>; the ready deadline was restarted.`,
      });
      return;
    }
    if (subcommand === 'rollback') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('ROLLBACK_MATCH', actor);
      const matchId = interaction.options.getString('match_id', true);
      const match = await dependencies.prisma.match.findUnique({ where: { id: matchId } });
      if (
        match === null ||
        match.guildId !== interaction.guildId ||
        match.resultStatus !== 'APPLIED'
      ) {
        throw new Error('No applied result exists for that match.');
      }
      await interaction.editReply({
        content: `This reverses the rating ledger for match ${match.id.slice(0, 8)}. Confirm within five minutes.`,
        components: buildRollbackConfirmationControls(
          {
            matchId: match.id,
            version: match.version,
            phaseGeneration: match.phaseGeneration,
            actorDiscordUserId: interaction.user.id,
            expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
          },
          dependencies.componentSigningSecret,
        ),
      });
      return;
    }
    if (subcommand === 'queue-ban') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('QUEUE_BAN', actor);
      const target = interaction.options.getUser('player', true);
      const reason = interaction.options.getString('reason', true);
      const durationMinutes = interaction.options.getInteger('duration_minutes');
      const expiresAt =
        durationMinutes === null ? null : new Date(Date.now() + durationMinutes * 60_000);
      await new QueueBanService(dependencies.prisma).ban(
        interaction.guildId,
        target.id,
        interaction.user.id,
        reason,
        expiresAt,
        interaction.id,
      );
      await interaction.editReply({
        content: `<@${target.id}> has been banned from the queue${expiresAt === null ? '' : ` until <t:${String(Math.floor(expiresAt.getTime() / 1000))}:f>`}.`,
      });
      return;
    }
    if (subcommand === 'queue-unban') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('QUEUE_UNBAN', actor);
      const target = interaction.options.getUser('player', true);
      await new QueueBanService(dependencies.prisma).unban(
        interaction.guildId,
        target.id,
        interaction.user.id,
        interaction.id,
      );
      await interaction.editReply({
        content: `<@${target.id}> has been unbanned from the queue.`,
      });
      return;
    }
  }

  await interaction.editReply({
    content: 'This command is not available in the current state.',
  });
}

const TENMAN_COMMAND_NAMES = new Set(['10man', 'steam', 'match', 'player', 'party']);

export function isTenManSetupCommand(interaction: {
  commandName: string;
  options: { getSubcommandGroup(required?: boolean): string | null; getSubcommand(): string };
}): boolean {
  return (
    interaction.commandName === 'match' &&
    interaction.options.getSubcommandGroup(false) === 'admin' &&
    interaction.options.getSubcommand() === 'setup'
  );
}

/**
 * Server-side containment for every 10man slash command except its privileged
 * bootstrap command. Command registration alone cannot enforce channel scope.
 */
export function isManagedTenManCommandChannel(
  channelId: string | null,
  settings: Pick<TenManSettings, 'managedResourceState' | 'managedChannelIds'> | null,
): boolean {
  return (
    channelId !== null &&
    settings?.managedResourceState === 'ACTIVE' &&
    settings.managedChannelIds.includes(channelId)
  );
}

function formatRecentMatches(
  discordUserId: string,
  matches: readonly {
    id: string;
    selectedMap: string | null;
    score: unknown;
    resultStatus: string;
    finishedAt: Date | null;
  }[],
): string {
  if (matches.length === 0) return `<@${discordUserId}> has no finished matches yet.`;
  return [
    `Recent matches for <@${discordUserId}>:`,
    ...matches.map(
      (match) =>
        `• ${match.id.slice(0, 8)} — ${match.selectedMap ?? 'map pending'} — ${match.resultStatus.toLowerCase()}${match.finishedAt === null ? '' : ` — <t:${String(Math.floor(match.finishedAt.getTime() / 1000))}:d>`}`,
    ),
  ].join('\n');
}

function formatManagedPreview(preview: ManagedPreview, teardown: boolean): string {
  const ids = [preview.categoryId, ...preview.channelIds].filter((id): id is string => id !== null);
  const resources =
    ids.length === 0 ? 'No persisted resources.' : ids.map((id) => `<#${id}>`).join('\n');
  return teardown
    ? `This archives and locks these bot-managed Discord resources. No channel will be deleted; a Discord administrator may remove archived resources manually:\n${resources}\n\nConfirm within five minutes.`
    : `Interrupted setup step: ${preview.setupStep ?? 'unknown'}\nPersisted resources:\n${resources}\n\nInspect Discord for any untracked resource from the interrupted step, remove it manually, then acknowledge within five minutes.`;
}

function formatDiagnosticsReport(report: {
  configured: boolean;
  enabled: boolean;
  channels: { label: string; ok: boolean; error?: string }[];
  roles: { label: string; ok: boolean; error?: string }[];
  permissions: { label: string; ok: boolean; missing?: string[] }[];
  template?: { id: string; ok: boolean; error?: string };
  activeMatch?: { id: string; state: string; cleanupStatus: string } | null;
  managed?: {
    state: string;
    setupStep: string | null;
    categoryId: string | null;
    channelIds: string[];
    manageChannels: boolean;
    createdAt: Date | null;
  };
  tenMan?: {
    queue: {
      status: string;
      version: number;
      entries: number;
      panelChannelId: string | null;
      panelMessageId: string | null;
    } | null;
    formingMatch: {
      id: string;
      state: string;
      phaseDeadlineAt: Date | null;
      phaseGeneration: number;
      participants: number;
      ready: number;
    } | null;
  };
}): string {
  if (!report.configured) return 'This server is not configured. Use `/match admin configure`.';
  const status = (ok: boolean) => (ok ? 'OK' : 'FAIL');
  const lines = [`Configuration: ${report.enabled ? 'enabled' : 'disabled'}`];
  lines.push('Channels:');
  for (const channel of report.channels) {
    lines.push(
      `  ${channel.label}: ${status(channel.ok)}${channel.error ? ` (${channel.error})` : ''}`,
    );
  }
  lines.push('Roles:');
  for (const role of report.roles) {
    lines.push(`  ${role.label}: ${status(role.ok)}${role.error ? ` (${role.error})` : ''}`);
  }
  lines.push('Bot permissions:');
  for (const permission of report.permissions) {
    lines.push(
      `  ${permission.label}: ${status(permission.ok)}${permission.missing ? ` (missing: ${permission.missing.join(', ')})` : ''}`,
    );
  }
  if (report.template !== undefined) {
    lines.push(
      `Template server: ${status(report.template.ok)}${report.template.error ? ` (${report.template.error})` : ''}`,
    );
  }
  if (report.managed !== undefined) {
    lines.push(
      `Managed resources: ${report.managed.state}${report.managed.setupStep === null ? '' : ` (${report.managed.setupStep})`}`,
      `Manage Channels: ${status(report.managed.manageChannels)}`,
    );
  }
  if (report.activeMatch !== undefined) {
    lines.push(
      `Active match: ${report.activeMatch === null ? 'none' : `${report.activeMatch.state} (cleanup: ${report.activeMatch.cleanupStatus})`}`,
    );
  }
  if (report.tenMan !== undefined) {
    lines.push('10man queue:');
    lines.push(
      report.tenMan.queue === null
        ? '  not initialized'
        : `  ${report.tenMan.queue.status}; entries ${String(report.tenMan.queue.entries)}; version ${String(report.tenMan.queue.version)}; panel ${report.tenMan.queue.panelMessageId === null ? 'missing' : 'persisted'}`,
    );
    if (report.tenMan.formingMatch !== null) {
      lines.push(
        `Forming match: ${report.tenMan.formingMatch.state}; ready ${String(report.tenMan.formingMatch.ready)}/${String(report.tenMan.formingMatch.participants)}; generation ${String(report.tenMan.formingMatch.phaseGeneration)}${report.tenMan.formingMatch.phaseDeadlineAt === null ? '' : `; deadline <t:${String(Math.floor(report.tenMan.formingMatch.phaseDeadlineAt.getTime() / 1000))}:R>`}`,
      );
    }
  }
  return lines.join('\n');
}

async function createGuildAdminActor(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  prisma: PrismaClient,
): Promise<ActorContext> {
  if (interaction.guildId === null) throw new Error('Guild interaction required');
  const settings = await prisma.tenManSettings.findUnique({
    where: { guildId: interaction.guildId },
  });
  const nativeAdministrator =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const roles = interaction.member?.roles;
  const memberRoles =
    roles === undefined
      ? []
      : roles instanceof GuildMemberRoleManager
        ? [...roles.cache.keys()]
        : roles;
  return {
    discordUserId: interaction.user.id,
    isParticipant: false,
    isPrivilegedMember:
      settings !== null && memberRoles.some((role) => settings.privilegedRoleIds.includes(role)),
    isModerator:
      nativeAdministrator ||
      (settings !== null && memberRoles.some((role) => settings.moderatorRoleIds.includes(role))),
    isAdministrator:
      nativeAdministrator ||
      (settings !== null &&
        memberRoles.some((role) => settings.administratorRoleIds.includes(role))),
  };
}

async function createActorContext(
  interaction: MessageComponentInteraction | ChatInputCommandInteraction,
  matchId: string,
  prisma: PrismaClient,
): Promise<ActorContext> {
  if (interaction.guildId === null) throw new Error('Guild interaction required');
  const [settings, participant] = await Promise.all([
    prisma.tenManSettings.findUnique({ where: { guildId: interaction.guildId } }),
    prisma.matchPlayer.findUnique({
      where: { matchId_discordUserId: { matchId, discordUserId: interaction.user.id } },
      select: { id: true },
    }),
  ]);
  if (settings === null) throw new Error('Guild is not configured');
  const roles = interaction.member?.roles;
  const memberRoles =
    roles === undefined
      ? []
      : roles instanceof GuildMemberRoleManager
        ? [...roles.cache.keys()]
        : roles;
  const hasRole = (configured: readonly string[]): boolean =>
    memberRoles.some((role) => configured.includes(role));
  return {
    discordUserId: interaction.user.id,
    isParticipant: participant !== null,
    isPrivilegedMember: hasRole(settings.privilegedRoleIds),
    isModerator: hasRole(settings.moderatorRoleIds),
    isAdministrator: hasRole(settings.administratorRoleIds),
  };
}
