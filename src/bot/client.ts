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
import type { PrismaClient } from '../generated/prisma/client.js';
import type { MatchService } from '../modules/tenman/services/match-service.js';
import type { SteamLinkService } from '../modules/tenman/services/steam-link-service.js';
import { GuildSettingsService } from '../modules/tenman/services/guild-settings-service.js';
import type { MatchControlService } from '../modules/tenman/services/match-control-service.js';
import type { CredentialCipher } from '../modules/tenman/services/credential-cipher.js';
import type { DatHostClient } from '../modules/tenman/integrations/dathost/client.js';
import { DiagnosticsService } from '../modules/tenman/services/diagnostics-service.js';
import { PanelService } from '../modules/tenman/services/panel-service.js';
import { renderMatchPanel } from '../modules/tenman/bot/panel.js';
import { commands } from '../modules/tenman/bot/commands.js';
import { buildMatchControls, buildTeamChoiceControls } from '../modules/tenman/bot/components.js';
import { parseCustomId } from '../modules/tenman/bot/custom-id.js';
import { assertAuthorized, type ActorContext } from '../modules/tenman/domain/authorization.js';
import type { Logger } from 'pino';
import { publicMessage } from '../errors/public-error.js';
import { parseMatchScore } from '../modules/tenman/domain/score.js';
import {
  GuildResourceService,
  type ManagedPreview,
} from '../modules/tenman/services/guild-resource-service.js';
import { adminGeneration, parseAdminCustomId } from '../modules/tenman/bot/admin-custom-id.js';
import { buildAdminConfirmationControls } from '../modules/tenman/bot/admin-components.js';
import { ModuleRegistry } from '../core/modules/registry.js';
import { createTenManModule } from '../modules/tenman/module.js';
import { RewardService } from '../modules/rewards/services/reward-service.js';
import { TextActivityService } from '../modules/rewards/services/text-activity-service.js';
import { createRewardsModule } from '../modules/rewards/module.js';
import { LevelRoleService } from '../modules/rewards/services/level-role-service.js';
import { VoiceActivityService } from '../modules/rewards/services/voice-activity-service.js';
import { TagLoyaltyService } from '../modules/rewards/services/tag-loyalty-service.js';

async function fetchAllowedProfiles(
  prisma: PrismaClient,
): Promise<{ key: string; label: string }[]> {
  const profiles = await prisma.gameProfile.findMany({
    where: { enabled: true },
    orderBy: { key: 'asc' },
    select: { key: true },
  });
  return profiles.map((profile) => ({ key: profile.key, label: profile.key }));
}

export interface BotDependencies {
  token: string;
  clientId: string;
  prisma: PrismaClient;
  matchService: MatchService;
  steamLinkService: SteamLinkService;
  matchControlService: MatchControlService;
  dathost: DatHostClient;
  cipher: CredentialCipher;
  componentSigningSecret: string;
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
        } else if (interaction.customId.startsWith('tma:')) {
          await handleAdminComponent(interaction, dependencies, guildResourceService);
        } else {
          await handleComponent(interaction, dependencies, dependencies.matchControlService);
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
  if (interaction.commandName === '10man' && interaction.options.getSubcommand() === 'create') {
    const settings = await dependencies.prisma.tenManSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const roles = interaction.member?.roles;
    const memberRoles =
      roles === undefined
        ? []
        : roles instanceof GuildMemberRoleManager
          ? [...roles.cache.keys()]
          : roles;
    if (
      settings === null ||
      !memberRoles.some((role) =>
        [
          ...settings.privilegedRoleIds,
          ...settings.moderatorRoleIds,
          ...settings.administratorRoleIds,
        ].includes(role),
      )
    ) {
      throw new Error('Privileged role required');
    }
    if (settings.lobbyTextChannelId === null)
      throw new Error('Lobby text channel is not configured');
    const lobbyChannel = await client.channels.fetch(settings.lobbyTextChannelId);
    if (lobbyChannel === null || !lobbyChannel.isTextBased() || lobbyChannel.isDMBased()) {
      throw new Error('Configured lobby text channel is unavailable');
    }
    const matchId = await dependencies.matchService.create({
      guildId: interaction.guildId,
      leaderDiscordUserId: interaction.user.id,
      displayName: interaction.user.globalName ?? interaction.user.username,
      correlationId: interaction.id,
    });
    const panelService = new PanelService(
      dependencies.prisma,
      client,
      dependencies.componentSigningSecret,
    );
    try {
      const published = await panelService.publishInitialPanel(matchId, lobbyChannel);
      await interaction.editReply({
        content: `10man created in <#${published.channelId}>: ${matchId}`,
      });
    } catch (error: unknown) {
      await dependencies.matchService.failUnpublishedMatch(matchId, interaction.id);
      throw error;
    }
    return;
  }
  if (interaction.commandName === '10man' && interaction.options.getSubcommand() === 'cancel') {
    const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
    if (match === null) throw new Error('No active match');
    const actor = await createActorContext(interaction, match.id, dependencies.prisma);
    await dependencies.matchService.cancel(match.id, actor, interaction.id);
    await interaction.editReply({
      content: 'The match was canceled. Cleanup status is available in `/10man status`.',
    });
    return;
  }
  if (interaction.commandName === '10man' && interaction.options.getSubcommand() === 'status') {
    const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
    if (match === null) {
      await interaction.editReply({ content: 'There is no active 10man.' });
      return;
    }
    const panel = renderMatchPanel({
      matchId: match.id,
      leaderMention: `<@${match.leaderDiscordUserId}>`,
      state: match.state,
      cleanupStatus: match.cleanupStatus,
      map: match.selectedMap,
      profile: match.selectedGameProfileKey,
      readyCount: match.players.filter((player) => player.readyState === 'READY').length,
      totalCount: match.players.length,
      team1: match.players
        .filter((player) => player.team === 'TEAM_1')
        .map((player) => player.displayNameSnapshot),
      team2: match.players
        .filter((player) => player.team === 'TEAM_2')
        .map((player) => player.displayNameSnapshot),
      score: parseMatchScore(match.score),
    });
    const allowedProfiles = await fetchAllowedProfiles(dependencies.prisma);
    await interaction.editReply({
      embeds: [panel],
      components: buildMatchControls({
        matchId: match.id,
        version: match.version,
        state: match.state,
        allowedMaps: match.profile.mapAllowlist,
        allowedProfiles,
        secret: dependencies.componentSigningSecret,
      }),
    });
    return;
  }
  if (interaction.commandName === 'match') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'transfer') {
      const target = interaction.options.getUser('player', true);
      const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (match === null) throw new Error('No active match');
      const actor = await createActorContext(interaction, match.id, dependencies.prisma);
      await dependencies.matchService.transferLeader(match.id, target.id, actor, interaction.id);
      await interaction.editReply({
        content: `Leader transferred to <@${target.id}>.`,
      });
      return;
    }
    if (subcommand === 'remove') {
      const target = interaction.options.getUser('player', true);
      const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
      if (match === null) throw new Error('No active match');
      const actor = await createActorContext(interaction, match.id, dependencies.prisma);
      await dependencies.matchService.removeParticipant(match.id, target.id, actor, interaction.id);
      await interaction.editReply({
        content: `<@${target.id}> removed from the match.`,
      });
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
      const privilegedRole = interaction.options.getRole('privileged_role', true);
      const moderatorRole = interaction.options.getRole('moderator_role', true);
      const administratorRole = interaction.options.getRole('administrator_role', true);
      const defaultServerLocation = interaction.options.getString('dathost_location') ?? undefined;
      const defaultGameProfileKey =
        interaction.options.getString('default_game_profile') ?? undefined;
      await guildSettingsService.update({
        guildId: interaction.guildId,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
        lobbyTextChannelId: lobbyTextChannel.id,
        lobbyVoiceChannelId: lobbyVoiceChannel.id,
        team1VoiceChannelId: team1VoiceChannel.id,
        team2VoiceChannelId: team2VoiceChannel.id,
        privilegedRoleIds: [privilegedRole.id],
        moderatorRoleIds: [moderatorRole.id],
        administratorRoleIds: [administratorRole.id],
        dathostTemplateServerId: interaction.options.getString('dathost_template_server_id', true),
        ...(defaultServerLocation === undefined ? {} : { defaultServerLocation }),
        ...(defaultGameProfileKey === undefined ? {} : { defaultGameProfileKey }),
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
  }

  await interaction.editReply({
    content: 'This command is not available in the current state.',
  });
}

async function handleAdminComponent(
  interaction: MessageComponentInteraction,
  dependencies: BotDependencies,
  guildResourceService: GuildResourceService,
): Promise<void> {
  if (interaction.guildId === null) throw new Error('Guild interaction required');
  await interaction.deferUpdate();
  const payload = parseAdminCustomId(interaction.customId, dependencies.componentSigningSecret);
  if (
    payload.guildId !== interaction.guildId ||
    payload.actorDiscordUserId !== interaction.user.id
  ) {
    throw new Error('Administrative confirmation does not belong to this interaction');
  }
  const adminActor = await createGuildAdminActor(interaction, dependencies.prisma);
  assertAuthorized(
    payload.action === 'TC' || payload.action === 'TX' ? 'TEARDOWN_GUILD' : 'RECOVER_GUILD_SETUP',
    adminActor,
  );
  if (payload.action === 'TX' || payload.action === 'RX') {
    await interaction.editReply({ content: 'Administrative action canceled.', components: [] });
    return;
  }
  const preview =
    payload.action === 'TC'
      ? await guildResourceService.teardownPreview(interaction.guildId)
      : await guildResourceService.recoverPreview(interaction.guildId);
  if (
    preview.settingsVersion !== payload.settingsVersion ||
    adminGeneration(preview.attemptId, preview.settingsVersion) !== payload.generation
  ) {
    throw new Error('Administrative confirmation is stale');
  }
  if (payload.action === 'TC') {
    await guildResourceService.teardown(
      interaction.guildId,
      interaction.user.id,
      interaction.id,
      payload.settingsVersion,
    );
    await interaction.editReply({
      content: 'Managed 10man channels were removed.',
      components: [],
    });
  } else {
    await guildResourceService.recoverSetup(
      interaction.guildId,
      interaction.user.id,
      interaction.id,
      payload.settingsVersion,
    );
    await interaction.editReply({
      content: 'Managed setup recovery completed. You can run `/match admin setup` again.',
      components: [],
    });
  }
}

async function handleComponent(
  interaction: MessageComponentInteraction,
  dependencies: BotDependencies,
  matchControlService: MatchControlService,
): Promise<void> {
  if (interaction.guildId === null) throw new Error('Guild interaction required');
  const payload = parseCustomId(interaction.customId, dependencies.componentSigningSecret);
  const privateResponse = ['GET_CONNECT_INFO', 'SELECT_TEAM_PARTICIPANT'].includes(payload.action);
  if (privateResponse) await interaction.deferReply({ ephemeral: true });
  else await interaction.deferUpdate();
  const match = await dependencies.matchService.findGuildMatch(interaction.guildId);
  if (match === null || match.id !== payload.matchId) throw new Error('Match is no longer active');
  const actor = await createActorContext(interaction, match.id, dependencies.prisma);
  const displayName = interaction.user.globalName ?? interaction.user.username;
  const authContext = {
    leaderDiscordUserId: match.leaderDiscordUserId,
    state: match.state,
  };

  if (payload.action === 'JOIN') {
    await dependencies.matchService.join({
      matchId: match.id,
      discordUserId: interaction.user.id,
      displayName,
      correlationId: interaction.id,
    });
  } else if (payload.action === 'LEAVE') {
    await dependencies.matchService.leave(match.id, actor, interaction.id);
  } else if (payload.action === 'RANDOMIZE_TEAMS') {
    await dependencies.matchService.randomizeTeams(
      match.id,
      actor,
      payload.version,
      interaction.id,
    );
  } else if (payload.action === 'LOCK_TEAMS') {
    await dependencies.matchService.lockTeams(match.id, actor, payload.version, interaction.id);
  } else if (payload.action === 'SELECT_MAP' && interaction.isStringSelectMenu()) {
    const mapName = interaction.values[0];
    if (mapName === undefined) throw new Error('Map selection is missing');
    await dependencies.matchService.selectMap(
      match.id,
      mapName,
      actor,
      payload.version,
      interaction.id,
    );
  } else if (payload.action === 'SELECT_PROFILE' && interaction.isStringSelectMenu()) {
    const profileKey = interaction.values[0];
    if (profileKey === undefined) throw new Error('Profile selection is missing');
    assertAuthorized('SELECT_PROFILE', actor, authContext);
    await dependencies.matchService.selectProfile(
      match.id,
      profileKey,
      actor,
      payload.version,
      interaction.id,
    );
  } else if (payload.action === 'SELECT_TEAM_PARTICIPANT' && interaction.isUserSelectMenu()) {
    assertAuthorized('ORGANIZE_TEAMS', actor, authContext);
    const target = interaction.values[0];
    if (target === undefined) throw new Error('Player selection is missing');
    if (!match.players.some((player) => player.discordUserId === target)) {
      throw new Error('Selected user is not a participant');
    }
    await interaction.editReply({
      content: `Choose a team for <@${target}>.`,
      components: buildTeamChoiceControls(
        match.id,
        payload.version,
        target,
        dependencies.componentSigningSecret,
      ),
    });
    return;
  } else if (payload.action === 'ASSIGN_TEAM_1' || payload.action === 'ASSIGN_TEAM_2') {
    const target = payload.targetDiscordUserId;
    if (target === undefined) throw new Error('Player selection is missing');
    await dependencies.matchService.assignTeam(
      match.id,
      target,
      payload.action === 'ASSIGN_TEAM_1' ? 'TEAM_1' : 'TEAM_2',
      actor,
      payload.version,
      interaction.id,
    );
  } else if (payload.action === 'READY' || payload.action === 'UNREADY') {
    assertAuthorized('READY', actor, authContext);
    await dependencies.matchService.setReady(
      match.id,
      actor,
      payload.action === 'READY',
      interaction.id,
    );
  } else if (payload.action === 'GET_CONNECT_INFO') {
    assertAuthorized('VIEW', actor, authContext);
    const matchWithConnection = await dependencies.prisma.match.findUnique({
      where: { id: match.id },
      select: {
        dathostIp: true,
        dathostPort: true,
        dathostServerId: true,
        encryptedJoinPassword: true,
      },
    });
    if (
      matchWithConnection === null ||
      matchWithConnection.dathostServerId === null ||
      matchWithConnection.dathostIp === null ||
      matchWithConnection.dathostPort === null ||
      matchWithConnection.encryptedJoinPassword === null
    )
      throw new Error('Connection info is not available yet');
    const password = dependencies.cipher.decrypt(
      matchWithConnection.encryptedJoinPassword,
      `join:${match.id}:${matchWithConnection.dathostServerId}`,
    );
    await interaction.editReply({
      content: `\`connect ${matchWithConnection.dathostIp}:${String(matchWithConnection.dathostPort)}; password ${password}\``,
    });
    return;
  } else if (payload.action === 'FORCE_START') {
    assertAuthorized('START_MATCH', actor, authContext);
    await matchControlService.forceStart(match.id, interaction.user.id, interaction.id);
  } else if (payload.action === 'PAUSE') {
    assertAuthorized('PAUSE', actor, authContext);
    await matchControlService.pause(match.id, interaction.user.id, interaction.id);
  } else if (payload.action === 'RESUME') {
    assertAuthorized('RESUME', actor, authContext);
    await matchControlService.resume(match.id, interaction.user.id, interaction.id);
  } else if (payload.action === 'FORCE_END') {
    assertAuthorized('STOP', actor, authContext);
    await matchControlService.forceEnd(match.id, interaction.user.id, interaction.id);
  } else if (payload.action === 'RESTORE_ROUND' && interaction.isStringSelectMenu()) {
    assertAuthorized('RESTORE', actor, authContext);
    const roundValue = interaction.values[0];
    if (roundValue === undefined) throw new Error('Round selection is missing');
    const round = Number.parseInt(roundValue, 10);
    if (Number.isNaN(round)) throw new Error('Invalid round');
    await matchControlService.restoreRound(match.id, round, interaction.user.id, interaction.id);
  } else {
    throw new Error('Unsupported match control');
  }

  const updated = await dependencies.matchService.findGuildMatch(interaction.guildId);
  if (updated === null) {
    await interaction.editReply({
      content: 'The match is no longer active.',
      embeds: [],
      components: [],
    });
    return;
  }
  const updatedProfiles = await fetchAllowedProfiles(dependencies.prisma);
  await interaction.editReply({
    embeds: [
      renderMatchPanel({
        matchId: updated.id,
        leaderMention: `<@${updated.leaderDiscordUserId}>`,
        state: updated.state,
        cleanupStatus: updated.cleanupStatus,
        map: updated.selectedMap,
        profile: updated.selectedGameProfileKey,
        readyCount: updated.players.filter((player) => player.readyState === 'READY').length,
        totalCount: updated.players.length,
        team1: updated.players
          .filter((player) => player.team === 'TEAM_1')
          .map((player) => player.displayNameSnapshot),
        team2: updated.players
          .filter((player) => player.team === 'TEAM_2')
          .map((player) => player.displayNameSnapshot),
        score: parseMatchScore(match.score),
      }),
    ],
    components: buildMatchControls({
      matchId: updated.id,
      version: updated.version,
      state: updated.state,
      allowedMaps: updated.profile.mapAllowlist,
      allowedProfiles: updatedProfiles,
      secret: dependencies.componentSigningSecret,
    }),
  });
}

function formatManagedPreview(preview: ManagedPreview, teardown: boolean): string {
  const ids = [preview.categoryId, ...preview.channelIds].filter((id): id is string => id !== null);
  const resources =
    ids.length === 0 ? 'No persisted resources.' : ids.map((id) => `<#${id}>`).join('\n');
  return teardown
    ? `This permanently deletes these bot-managed Discord resources:\n${resources}\n\nConfirm within five minutes.`
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
    isPrivilegedMember: false,
    isModerator: false,
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
