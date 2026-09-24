import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMemberRoleManager,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { MatchService } from '../modules/tenman/services/match-service.js';
import type { SteamAccountService } from '../modules/tenman/services/steam-account-service.js';
import type { SteamProfileService } from '../modules/tenman/services/steam-profile-service.js';
import { PlayerStatusService } from '../modules/tenman/services/player-status-service.js';
import { SteamAdminService } from '../modules/tenman/services/steam-admin-service.js';
import { GuildSettingsService } from '../modules/tenman/services/guild-settings-service.js';
import { buildPlayerHubResponse } from '../modules/tenman/bot/player-hub-components.js';
import { MatchResultDisputeService } from '../modules/tenman/services/match-result-dispute-service.js';
import { QueueAlertService } from '../modules/tenman/services/queue-alert-service.js';
import type { DatHostClient } from '../modules/tenman/integrations/dathost/client.js';
import { DiagnosticsService } from '../modules/tenman/services/diagnostics-service.js';
import { commands } from '../modules/tenman/bot/commands.js';
import { assertAuthorized, type ActorContext } from '../modules/tenman/domain/authorization.js';
import type { Logger } from 'pino';
import { publicMessage } from '../errors/public-error.js';
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
import {
  EphemeralReplyManager,
  TenManComponentInteractionRouter,
  buildSteamAccountStatusResponse,
} from '../modules/tenman/bot/interaction-router.js';
import { MatchHistoryService } from '../modules/tenman/services/match-history-service.js';
import { PartyService } from '../modules/tenman/services/party-service.js';
import { buildPartyPanelResponse } from '../modules/tenman/bot/party-components.js';
import {
  buildAdminDisputesPanel,
  buildAdminMatchPanel,
  buildAdminPlayersPanel,
  buildAdminQueuePanel,
  buildHistoryResponse,
} from '../modules/tenman/bot/admin-panels.js';
import type { CredentialCipher } from '../modules/tenman/services/credential-cipher.js';
import { MatchParticipantInfoService } from '../modules/tenman/services/match-participant-info-service.js';

export interface BotDependencies {
  token: string;
  clientId: string;
  prisma: PrismaClient;
  matchService: MatchService;
  steamAccountService: SteamAccountService;
  steamProfileService: SteamProfileService;
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
  const ephemeralReplies = new EphemeralReplyManager();
  const tenManComponentRouter = new TenManComponentInteractionRouter(
    {
      prisma: dependencies.prisma,
      componentSigningSecret: dependencies.componentSigningSecret,
      actorFor: (interaction, matchId) =>
        createActorContext(interaction, matchId, dependencies.prisma),
      adminActorFor: (interaction) => createGuildAdminActor(interaction, dependencies.prisma),
      guildResourceService,
      matchService: dependencies.matchService,
      steamAccountService: dependencies.steamAccountService,
      steamProfileService: dependencies.steamProfileService,
      discord: client,
      participantInfo: new MatchParticipantInfoService(
        dependencies.prisma,
        dependencies.credentialCipher,
      ),
    },
    ephemeralReplies,
  );
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
            ephemeralReplies,
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
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isMessageComponent() &&
      !interaction.isModalSubmit()
    )
      return;
    const operation = modules.dispatch(interaction).then(async (handled) => {
      if (!handled)
        await ephemeralReplies.reply(interaction, { content: 'Unknown module interaction.' });
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
      if (interaction.isModalSubmit()) {
        await ephemeralReplies
          .reply(interaction, { content, components: [] })
          .catch(() => undefined);
        return;
      }
      if (interaction.deferred) {
        await interaction.editReply({ content, components: [] }).catch(() => undefined);
      } else if (interaction.replied) {
        await interaction
          .followUp({ content, flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      } else {
        await ephemeralReplies.reply(interaction, { content }).catch(() => undefined);
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
  ephemeralReplies: EphemeralReplyManager,
): Promise<void> {
  if (interaction.guildId === null) throw new Error('Guild command required');
  await ephemeralReplies.replace(interaction, () =>
    interaction.deferReply({ flags: MessageFlags.Ephemeral }),
  );
  const subcommand = interaction.options.getSubcommand();

  if (interaction.commandName === '10man') {
    if (subcommand === 'hub') {
      const [status, queue, match] = await Promise.all([
        new PlayerStatusService(dependencies.prisma).getStatus(
          interaction.guildId,
          interaction.user.id,
        ),
        dependencies.prisma.tenManQueue.findUnique({ where: { guildId: interaction.guildId } }),
        dependencies.prisma.match.findFirst({
          where: {
            guildId: interaction.guildId,
            guildSlotActive: true,
            players: { some: { discordUserId: interaction.user.id } },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const { embeds, components } = buildPlayerHubResponse(
        status,
        interaction.guildId,
        interaction.user.id,
        queue?.version ?? 0,
        match?.version ?? 0,
        match?.phaseGeneration ?? 0,
        dependencies.componentSigningSecret,
      );
      await interaction.editReply({ embeds, components });
      return;
    }
    if (subcommand === 'account') {
      await renderSteamAccountStatus(
        interaction,
        dependencies.steamAccountService,
        dependencies.componentSigningSecret,
      );
      return;
    }
    if (subcommand === 'history') {
      const target = interaction.options.getUser('player') ?? interaction.user;
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      const matches = await new MatchHistoryService(dependencies.prisma).recentMatches(
        interaction.guildId,
        target.id,
      );
      await interaction.editReply(
        buildHistoryResponse(
          matches,
          target.id,
          actor.isModerator || actor.isAdministrator,
          interaction.guildId,
          interaction.user.id,
          dependencies.componentSigningSecret,
        ),
      );
      return;
    }
    if (subcommand === 'stats') {
      const target = interaction.options.getUser('player') ?? interaction.user;
      const stats = await dependencies.prisma.playerGuildStats.findUnique({
        where: {
          guildId_discordUserId: { guildId: interaction.guildId, discordUserId: target.id },
        },
      });
      const embed = new EmbedBuilder().setTitle('10man Stats').setColor(0x5865f2);
      if (stats === null) {
        embed.setDescription(`<@${target.id}> has no match statistics yet.`);
      } else {
        embed.setDescription(`Statistics for <@${target.id}>.`).addFields(
          { name: 'Rating', value: String(stats.rating), inline: true },
          {
            name: 'Record',
            value: `${String(stats.wins)}W — ${String(stats.losses)}L`,
            inline: true,
          },
          { name: 'Matches', value: String(stats.matchesPlayed), inline: true },
        );
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    if (subcommand === 'party') {
      const partyService = new PartyService(dependencies.prisma);
      const state = await partyService.getPanelState(interaction.guildId, interaction.user.id);
      await interaction.editReply(
        buildPartyPanelResponse(
          state,
          interaction.guildId,
          interaction.user.id,
          dependencies.componentSigningSecret,
        ),
      );
      return;
    }
    if (subcommand === 'alerts') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await new QueueAlertService(dependencies.prisma, client).setPreference(
        interaction.guildId,
        interaction.user.id,
        enabled,
      );
      await interaction.editReply({
        content: `Queue fill alerts ${enabled ? 'enabled' : 'disabled'}. You will ${enabled ? 'receive' : 'no longer receive'} direct-message notifications when the queue nears full.`,
      });
      return;
    }
  }

  if (interaction.commandName === '10man-admin') {
    if (subcommand === 'match') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('VIEW_ADMIN', actor);
      const active = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (active === null) {
        await interaction.editReply({
          content: "There isn't a match to manage right now.",
        });
        return;
      }
      const match = await dependencies.prisma.match.findUnique({
        where: { id: active.id },
        include: { players: { select: { discordUserId: true } } },
      });
      if (match === null) throw new Error('Match is no longer active');
      await interaction.editReply(
        buildAdminMatchPanel(
          match,
          interaction.guildId,
          interaction.user.id,
          dependencies.componentSigningSecret,
        ),
      );
      return;
    }
    if (subcommand === 'queue') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('QUEUE_BAN', actor);
      const [queue, bans] = await Promise.all([
        dependencies.prisma.tenManQueue.findUnique({
          where: { guildId: interaction.guildId },
          include: { entries: { select: { discordUserId: true } } },
        }),
        dependencies.prisma.tenManQueueBan.findMany({
          where: { guildId: interaction.guildId, revokedAt: null },
          select: { discordUserId: true, reason: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
      ]);
      await interaction.editReply(
        buildAdminQueuePanel(
          queue,
          bans,
          interaction.guildId,
          interaction.user.id,
          dependencies.componentSigningSecret,
        ),
      );
      return;
    }
    if (subcommand === 'players') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('RESET_PLAYER_STATS', actor);
      await interaction.editReply(
        buildAdminPlayersPanel(
          interaction.guildId,
          interaction.user.id,
          dependencies.componentSigningSecret,
        ),
      );
      return;
    }
    if (subcommand === 'disputes') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('RESOLVE_DISPUTE', actor);
      const [steamDisputes, resultDisputes] = await Promise.all([
        new SteamAdminService(
          dependencies.prisma,
          dependencies.steamProfileService,
        ).listPendingDisputes(interaction.guildId),
        new MatchResultDisputeService(dependencies.prisma).listPending(interaction.guildId),
      ]);
      await interaction.editReply(
        buildAdminDisputesPanel(
          steamDisputes,
          resultDisputes,
          interaction.guildId,
          interaction.user.id,
          dependencies.componentSigningSecret,
        ),
      );
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
    if (subcommand === 'queue-panel') {
      const actor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('VIEW_ADMIN', actor);
      const settings = await dependencies.prisma.tenManSettings.findUnique({
        where: { guildId: interaction.guildId },
      });
      if (settings === null || !settings.enabled) {
        throw new Error('10man is not enabled for this server');
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
  }

  if (interaction.commandName === '10man-config') {
    if (subcommand === 'status') {
      const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
      assertAuthorized('CONFIGURE_GUILD', adminActor);
      const settings = await dependencies.prisma.tenManSettings.findUnique({
        where: { guildId: interaction.guildId },
      });
      if (settings === null) {
        await interaction.editReply({
          content: 'This server is not configured. Use `/10man-config configure`.',
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
        content: `Managed 10man channels created in <#${result.categoryId ?? ''}>. Run \`/10man-admin diagnostics\` to verify setup.`,
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
  }

  await interaction.editReply({
    content: 'This command is not available in the current state.',
  });
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
  if (!report.configured) return 'This server is not configured. Use `/10man-config configure`.';
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
  interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction,
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

async function renderSteamAccountStatus(
  interaction: ChatInputCommandInteraction,
  steamAccountService: SteamAccountService,
  secret: string,
): Promise<void> {
  const active = await steamAccountService.findActive(interaction.user.id);
  const { content, components } = buildSteamAccountStatusResponse(
    active,
    interaction.guildId ?? '',
    interaction.user.id,
    secret,
  );
  await interaction.editReply({ content, components });
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
