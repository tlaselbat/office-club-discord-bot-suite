import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { MatchService } from '../services/match-service.js';
import { assertAuthorized, type ActorContext } from '../domain/authorization.js';
import { CaptainService } from '../services/captain-service.js';
import { DraftService } from '../services/draft-service.js';
import { ReadyCheckService } from '../services/ready-check-service.js';
import { VetoService } from '../services/veto-service.js';
import { QueueService } from '../services/queue-service.js';
import { MatchHistoryService } from '../services/match-history-service.js';
import { MatchAdminService } from '../services/match-admin-service.js';
import type { GuildResourceService } from '../services/guild-resource-service.js';
import { QueuePanelService } from '../services/queue-panel-service.js';
import { AdminPanelService } from '../services/admin-panel-service.js';
import { GuildSettingsService } from '../services/guild-settings-service.js';
import { PlayerStatusService } from '../services/player-status-service.js';
import type { SteamAccountService } from '../services/steam-account-service.js';
import { SteamAdminService } from '../services/steam-admin-service.js';
import type { SteamProfileService } from '../services/steam-profile-service.js';
import { MatchResultDisputeService } from '../services/match-result-dispute-service.js';
import { QueueAlertService } from '../services/queue-alert-service.js';
import { adminGeneration, parseAdminCustomId } from './admin-custom-id.js';
import { parseMatchCustomId } from './match-custom-id.js';
import { createQueueCustomId, parseQueueCustomId } from './queue-custom-id.js';
import { parseAdminPanelCustomId } from './admin-panel-custom-id.js';
import { parseMatchModeratorCustomId } from './match-moderator-custom-id.js';
import { buildMatchModeratorPanel } from './match-moderator-components.js';
import { MatchModeratorService } from '../services/match-moderator-service.js';
import { MapPoolService } from '../services/map-pool-service.js';
import { buildMapPoolManagement } from './map-pool-components.js';
import { createMapPoolCustomId, parseMapPoolCustomId } from './map-pool-custom-id.js';
import { parseAdminQueueConfigCustomId } from './admin-queue-config-custom-id.js';
import {
  buildAdminQueueConfiguration,
  configurationDraftFromSettings,
} from './admin-queue-config-components.js';
import {
  joinQueueButton,
  leaveQueueButton,
  matchCenterButton,
  queueRefreshButton,
} from './queue-components.js';
import { parseMatchAdminCustomId } from './match-admin-custom-id.js';
import { parseMatchOpsCustomId } from './match-ops-custom-id.js';
import { createQueueAdminCustomId, parseQueueAdminCustomId } from './queue-admin-custom-id.js';
import { parsePartyCustomId } from './party-custom-id.js';
import { parsePlayerAdminCustomId } from './player-admin-custom-id.js';
import { parsePlayerHubCustomId, createPlayerHubCustomId } from './player-hub-custom-id.js';
import {
  parseSteamAccountCustomId,
  createSteamAccountCustomId,
} from './steam-account-custom-id.js';
import {
  parseResultDisputeCustomId,
  createResultDisputeCustomId,
} from './match-result-dispute-custom-id.js';
import { buildMatchCenterResponse } from './player-hub-components.js';
import { buildPartyInviteAcceptRows, buildPartyPanelResponse } from './party-components.js';
import {
  buildAdminMatchPanel,
  buildAdminQueuePanel,
  buildHistoryResponse,
  buildQueueBanModal,
  buildReplaceIncomingSelect,
  buildResultResolutionModal,
} from './admin-panels.js';
import {
  buildCancelMatchConfirmationControls,
  buildRestartPhaseConfirmationControls,
  buildRollbackConfirmationControls,
} from './match-admin-components.js';
import { buildPlayerStatsResetConfirmationControls } from './player-admin-components.js';
import { PartyService } from '../services/party-service.js';
import { QueueBanService } from '../services/queue-ban-service.js';
import {
  buildResultDisputeModal,
  buildResultDisputeAcknowledgedResponse,
} from './result-dispute-components.js';
import {
  buildDuplicateAssignmentResponse,
  buildSteamAccountButton,
  buildSteamAssignmentModal,
  buildAssignmentSuccessResponse,
  buildApiUnavailableResponse,
  buildDisputeAcknowledgedResponse,
  buildInvalidInputResponse,
  buildLockedAssignmentResponse,
} from './steam-account-components.js';
import type { MatchParticipantInfoService } from '../services/match-participant-info-service.js';

export interface InteractionRouterOptions {
  prisma: PrismaClient;
  componentSigningSecret: string;
  actorFor: (interaction: MessageComponentInteraction, matchId: string) => Promise<ActorContext>;
  participantInfo: Pick<MatchParticipantInfoService, 'get'>;
}

type EphemeralInteraction =
  | ChatInputCommandInteraction
  | MessageComponentInteraction
  | ModalSubmitInteraction;

export class EphemeralReplyManager {
  private readonly active = new Map<string, EphemeralInteraction>();
  private readonly pending = new Map<string, Promise<void>>();

  public async reply(
    interaction: EphemeralInteraction,
    options: InteractionReplyOptions,
  ): Promise<void> {
    await this.replace(interaction, () =>
      interaction.reply({ ...options, flags: MessageFlags.Ephemeral }),
    );
  }

  public async replace(
    interaction: EphemeralInteraction,
    acknowledge: () => Promise<unknown>,
  ): Promise<void> {
    const userId = interaction.user.id;
    const previousOperation = this.pending.get(userId) ?? Promise.resolve();
    const operation = previousOperation
      .catch(() => undefined)
      .then(async () => {
        const previous = this.active.get(userId);
        if (previous !== undefined && previous !== interaction) {
          await previous.deleteReply().catch(() => undefined);
        }
        await acknowledge();
        this.active.set(userId, interaction);
        setTimeout(() => {
          if (this.active.get(userId) === interaction) this.active.delete(userId);
        }, 15 * 60_000).unref();
      });
    this.pending.set(userId, operation);
    try {
      await operation;
    } finally {
      if (this.pending.get(userId) === operation) this.pending.delete(userId);
    }
  }
}

/** Routes signed first-release match-dashboard interactions. */
export class MatchInteractionRouter {
  private readonly readyCheckService: ReadyCheckService;
  private readonly captainService: CaptainService;
  private readonly draftService: DraftService;
  private readonly vetoService: VetoService;

  public constructor(
    private readonly options: InteractionRouterOptions,
    private readonly ephemeralReplies = new EphemeralReplyManager(),
  ) {
    this.readyCheckService = new ReadyCheckService(options.prisma);
    this.captainService = new CaptainService(options.prisma);
    this.draftService = new DraftService(options.prisma);
    this.vetoService = new VetoService(options.prisma);
  }

  public async handle(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseMatchCustomId(interaction.customId, this.options.componentSigningSecret);
    await this.ephemeralReplies.replace(interaction, () =>
      interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    );
    const match = await this.options.prisma.match.findUnique({ where: { id: payload.matchId } });
    if (
      match === null ||
      match.guildId !== interaction.guildId ||
      match.version !== payload.version ||
      match.phaseGeneration !== payload.phaseGeneration
    )
      throw new Error('Match dashboard is stale');
    if (payload.action === 'READY' || payload.action === 'WITHDRAW_READY') {
      await this.readyCheckService.setReady(
        match.id,
        interaction.user.id,
        payload.version,
        payload.action === 'READY',
        interaction.id,
      );
      await interaction.editReply({
        content: payload.action === 'READY' ? 'Ready confirmed.' : 'Ready status withdrawn.',
      });
      return;
    }
    if (payload.action === 'MY_MATCH_INFO') {
      const info = await this.options.participantInfo.get(
        match.id,
        interaction.guildId,
        interaction.user.id,
      );
      await interaction.editReply({
        content: [
          `**${info.team === 'TEAM_1' ? 'Team 1' : 'Team 2'}** — map: **${info.map}**`,
          `Voice: <#${info.voiceChannelId}>`,
          `Connect: \`${info.address}\``,
          `Password: \`${info.password}\``,
          'Keep these details private to match participants.',
        ].join('\n'),
      });
      return;
    }
    if (payload.action === 'SELECT_RANDOM_CAPTAINS') {
      const actor = await this.options.actorFor(interaction, match.id);
      assertAuthorized('ORGANIZE_TEAMS', actor, {
        leaderDiscordUserId: match.leaderDiscordUserId,
        state: match.state,
      });
      await this.captainService.selectRandom(match.id, payload.version, interaction.id);
      await interaction.editReply({ content: 'Captains selected.' });
      return;
    }
    if (payload.action === 'CANCEL') {
      const actor = await this.options.actorFor(interaction, match.id);
      assertAuthorized('STOP', actor, {
        leaderDiscordUserId: match.leaderDiscordUserId,
        state: match.state,
      });
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
          this.options.componentSigningSecret,
        ),
      });
      return;
    }
    if (payload.targetDiscordUserId !== interaction.user.id)
      throw new Error('This control is assigned to another player');
    if (payload.action === 'DRAFT_PICK' && interaction.isStringSelectMenu()) {
      const selectedDiscordUserId = interaction.values[0];
      if (selectedDiscordUserId === undefined) throw new Error('Player selection is missing');
      await this.draftService.pick(
        match.id,
        interaction.user.id,
        selectedDiscordUserId,
        payload.version,
        interaction.id,
      );
      await interaction.editReply({ content: 'Draft pick recorded.' });
      return;
    }
    if (payload.action === 'VETO_BAN' && interaction.isStringSelectMenu()) {
      const mapName = interaction.values[0];
      if (mapName === undefined) throw new Error('Map selection is missing');
      await this.vetoService.ban(
        match.id,
        interaction.user.id,
        mapName,
        payload.version,
        interaction.id,
      );
      await interaction.editReply({ content: 'Map ban recorded.' });
      return;
    }
    throw new Error('Unsupported match control');
  }
}

export interface TenManComponentInteractionRouterOptions extends InteractionRouterOptions {
  discord: Client;
  guildResourceService: GuildResourceService;
  adminActorFor: (
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
  ) => Promise<ActorContext>;
  matchService: MatchService;
  steamAccountService: SteamAccountService;
  steamProfileService: SteamProfileService;
  participantInfo: MatchParticipantInfoService;
}

type ComponentOrModal = MessageComponentInteraction | ModalSubmitInteraction;

const PUBLIC_PANEL_ACTOR_PLACEHOLDER = '00000000000000000000';

/** Owns every supported Office Club Competitive component namespace. */
export class TenManComponentInteractionRouter {
  private readonly match: MatchInteractionRouter;
  private readonly queueService: QueueService;
  private readonly queuePanelService: QueuePanelService;
  private readonly adminPanelService: AdminPanelService;
  private readonly matchModeratorService: MatchModeratorService;
  private readonly mapPoolService: MapPoolService;
  private readonly guildSettingsService: GuildSettingsService;
  private readonly matchHistory: MatchHistoryService;
  private readonly matchAdmin: MatchAdminService;
  private readonly playerStatusService: PlayerStatusService;
  private readonly steamAdminService: SteamAdminService;
  private readonly resultDisputeService: MatchResultDisputeService;
  private readonly queueAlertService: QueueAlertService;
  private readonly partyService: PartyService;
  private readonly queueBanService: QueueBanService;
  public constructor(
    private readonly options: TenManComponentInteractionRouterOptions,
    private readonly ephemeralReplies = new EphemeralReplyManager(),
  ) {
    this.match = new MatchInteractionRouter(options, ephemeralReplies);
    this.queueService = new QueueService(options.prisma);
    this.queuePanelService = new QueuePanelService(
      options.prisma,
      options.discord,
      options.componentSigningSecret,
    );
    this.adminPanelService = new AdminPanelService(
      options.prisma,
      options.discord,
      options.componentSigningSecret,
    );
    this.matchModeratorService = new MatchModeratorService(options.prisma);
    this.mapPoolService = new MapPoolService(options.prisma);
    this.guildSettingsService = new GuildSettingsService(options.prisma, options.discord);
    this.matchHistory = new MatchHistoryService(options.prisma);
    this.matchAdmin = new MatchAdminService(options.prisma);
    this.playerStatusService = new PlayerStatusService(options.prisma);
    this.steamAdminService = new SteamAdminService(options.prisma, options.steamProfileService);
    this.resultDisputeService = new MatchResultDisputeService(options.prisma);
    this.queueAlertService = new QueueAlertService(options.prisma, options.discord);
    this.partyService = new PartyService(options.prisma);
    this.queueBanService = new QueueBanService(options.prisma);
  }

  public async handle(interaction: ComponentOrModal): Promise<void> {
    if (interaction.isModalSubmit()) return this.handleModal(interaction);
    if (!interaction.isMessageComponent()) throw new Error('Unsupported interaction type');

    if (interaction.customId.startsWith('tps2:')) return this.handlePlayerAdmin(interaction);
    if (interaction.customId.startsWith('tma2:')) return this.handleMatchAdmin(interaction);
    if (interaction.customId.startsWith('tmo:')) return this.handleMatchOps(interaction);
    if (interaction.customId.startsWith('tqb:')) return this.handleQueueAdmin(interaction);
    if (interaction.customId.startsWith('tqc:'))
      return this.handleAdminQueueConfiguration(interaction);
    if (interaction.customId.startsWith('tqm:')) return this.handleMatchModerators(interaction);
    if (interaction.customId.startsWith('tqmp:')) return this.handleMapPool(interaction);
    if (interaction.customId.startsWith('tqa:')) return this.handleAdminPanel(interaction);
    if (interaction.customId.startsWith('tpy:')) return this.handleParty(interaction);
    if (interaction.customId.startsWith('tmm:')) return this.match.handle(interaction);
    if (interaction.customId.startsWith('tmq:')) return this.handleQueue(interaction);
    if (interaction.customId.startsWith('tmp:')) return this.handlePlayerHub(interaction);
    if (interaction.customId.startsWith('tms:')) return this.handleSteamAccount(interaction);
    if (interaction.customId.startsWith('tmd:')) return this.handleResultDispute(interaction);
    if (interaction.customId.startsWith('tma:')) return this.handleAdmin(interaction);
    throw new Error('Unsupported Office Club Competitive component namespace');
  }

  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    if (interaction.customId.startsWith('tms:')) {
      const payload = parseSteamAccountCustomId(
        interaction.customId,
        this.options.componentSigningSecret,
      );
      if (payload.action !== 'MODAL') throw new Error('Unsupported modal namespace');
      const rawInput = interaction.fields.getTextInputValue('steam_identifier');
      const result = await this.options.steamAccountService.assign({
        discordUserId: interaction.user.id,
        guildId: payload.guildId,
        rawInput,
        correlationId: interaction.id,
        actorDiscordUserId: payload.actorDiscordUserId,
        displayName: interaction.user.globalName ?? interaction.user.username,
      });
      switch (result.status) {
        case 'assigned':
        case 'replaced':
        case 'already_assigned':
          await this.ephemeralReplies.reply(interaction, {
            content: buildAssignmentSuccessResponse(result.steamId64, result.displayName),
            flags: MessageFlags.Ephemeral,
          });
          return;
        case 'duplicate':
          await this.ephemeralReplies.reply(interaction, {
            flags: MessageFlags.Ephemeral,
            ...buildDuplicateAssignmentResponse(
              payload.guildId,
              interaction.user.id,
              result.steamId64,
              this.options.componentSigningSecret,
            ),
          });
          return;
        case 'invalid_input':
          await this.ephemeralReplies.reply(interaction, {
            content: buildInvalidInputResponse(),
            flags: MessageFlags.Ephemeral,
          });
          return;
        case 'api_unavailable':
          await this.ephemeralReplies.reply(interaction, {
            content: buildApiUnavailableResponse(),
            flags: MessageFlags.Ephemeral,
          });
          return;
        case 'locked':
          await this.ephemeralReplies.reply(interaction, {
            content: buildLockedAssignmentResponse(result.reason),
            flags: MessageFlags.Ephemeral,
          });
          return;
      }
    }
    if (interaction.customId.startsWith('tqmp:')) {
      const payload = parseMapPoolCustomId(
        interaction.customId,
        this.options.componentSigningSecret,
      );
      if (
        payload.action !== 'ADD_SUBMIT' ||
        payload.guildId !== interaction.guildId ||
        payload.actorDiscordUserId !== interaction.user.id
      ) {
        throw new Error('Map catalog modal does not belong to this interaction');
      }
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('CONFIGURE_GUILD', actor);
      const settings = await this.options.prisma.tenManSettings.findUnique({
        where: { guildId: payload.guildId },
        select: { version: true },
      });
      if (settings === null || settings.version !== payload.settingsVersion)
        throw new Error('Configuration changed; reload and try again');
      await this.mapPoolService.addWorkshopMap({
        guildId: payload.guildId,
        mapName: interaction.fields.getTextInputValue('workshop_map_name'),
        displayName: interaction.fields.getTextInputValue('workshop_display_name'),
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
      const content = await this.buildMapPoolResponse(payload.guildId, interaction.user.id, 0);
      await this.ephemeralReplies.reply(interaction, { ...content, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.customId.startsWith('tmd:')) {
      const payload = parseResultDisputeCustomId(
        interaction.customId,
        this.options.componentSigningSecret,
      );
      if (payload.action === 'MODAL') {
        if (payload.matchId === undefined) throw new Error('Missing match reference');
        const reason = interaction.fields.getTextInputValue('dispute_reason');
        const result = await this.resultDisputeService.createDispute(
          payload.matchId,
          interaction.user.id,
          reason,
          interaction.id,
        );
        await this.ephemeralReplies.reply(interaction, {
          content: buildResultDisputeAcknowledgedResponse(result.id),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (payload.action === 'RSM') {
        if (payload.actorDiscordUserId !== interaction.user.id)
          throw new Error('Administrative confirmation does not belong to this interaction');
        if (payload.disputeId === undefined || payload.resolution === undefined)
          throw new Error('Missing dispute resolution fields');
        const actor = await this.options.adminActorFor(interaction);
        assertAuthorized('RESOLVE_DISPUTE', actor);
        const reason = interaction.fields.getTextInputValue('resolution_reason');
        await this.resultDisputeService.resolveDispute(
          payload.disputeId,
          payload.resolution,
          reason,
          interaction.user.id,
          interaction.id,
        );
        await this.ephemeralReplies.reply(interaction, {
          flags: MessageFlags.Ephemeral,
          content:
            payload.resolution === 'REVERSE'
              ? 'Dispute accepted and match result reversed.'
              : 'Dispute rejected.',
        });
        return;
      }
      throw new Error('Unsupported modal namespace');
    }
    if (interaction.customId.startsWith('tqb:')) {
      const payload = parseQueueAdminCustomId(
        interaction.customId,
        this.options.componentSigningSecret,
      );
      if (payload.action !== 'BAN_MODAL' || payload.targetDiscordUserId === undefined)
        throw new Error('Unsupported modal namespace');
      if (payload.actorDiscordUserId !== interaction.user.id)
        throw new Error('Administrative confirmation does not belong to this interaction');
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('QUEUE_BAN', actor);
      const reason = interaction.fields.getTextInputValue('ban_reason');
      const durationInput = interaction.fields.getTextInputValue('ban_duration_minutes').trim();
      let expiresAt: Date | null = null;
      if (durationInput !== '') {
        const minutes = Number.parseInt(durationInput, 10);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600)
          throw new Error('Ban duration must be a whole number of minutes.');
        expiresAt = new Date(Date.now() + minutes * 60_000);
      }
      await this.queueBanService.ban(
        payload.guildId,
        payload.targetDiscordUserId,
        interaction.user.id,
        reason,
        expiresAt,
        interaction.id,
      );
      await this.ephemeralReplies.reply(interaction, {
        flags: MessageFlags.Ephemeral,
        content: `<@${payload.targetDiscordUserId}> has been banned from the queue${expiresAt === null ? '' : ` until <t:${String(Math.floor(expiresAt.getTime() / 1000))}:f>`}.`,
      });
      return;
    }
    throw new Error('Unsupported modal namespace');
  }

  private async handleSteamAccount(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseSteamAccountCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    const { guildId } = payload;
    if (payload.action === 'OPEN' || payload.action === 'OTHER') {
      const modalCustomId = createSteamAccountCustomId(
        { action: 'MODAL', guildId, actorDiscordUserId: interaction.user.id },
        this.options.componentSigningSecret,
      );
      await interaction.showModal(buildSteamAssignmentModal(modalCustomId));
      return;
    }
    if (payload.action === 'REVIEW') {
      if (payload.targetDiscordUserId === undefined || payload.steamId64 === undefined) {
        throw new Error('Missing review request fields');
      }
      const { id } = await this.steamAdminService.createDispute(
        guildId,
        payload.targetDiscordUserId,
        payload.steamId64,
        interaction.id,
      );
      await this.ephemeralReplies.reply(interaction, {
        content: buildDisputeAcknowledgedResponse(id),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (payload.action === 'VIEW') {
      await this.ephemeralReplies.replace(interaction, () =>
        interaction.deferReply({ flags: MessageFlags.Ephemeral }),
      );
      const active = await this.options.steamAccountService.findActive(interaction.user.id);
      await interaction.editReply(
        buildSteamAccountStatusResponse(
          active,
          payload.guildId,
          interaction.user.id,
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    if (payload.action === 'REMOVE') {
      await interaction.deferUpdate();
      const result = await this.options.steamAccountService.remove({
        discordUserId: interaction.user.id,
        guildId: payload.guildId,
        correlationId: interaction.id,
        actorDiscordUserId: interaction.user.id,
      });
      switch (result.status) {
        case 'removed':
          await interaction.editReply({
            content:
              'Your Steam account assignment was removed. Assign a new account before joining the queue.',
            components: [],
          });
          return;
        case 'no_assignment':
          await interaction.editReply({
            content: 'You do not have an assigned Steam account.',
            components: [],
          });
          return;
        case 'locked':
          await interaction.editReply({
            content: buildLockedAssignmentResponse(result.reason),
            components: [],
          });
          return;
      }
      return;
    }
    if (payload.action === 'RESOLVE' || payload.action === 'REJECT') {
      await this.ephemeralReplies.replace(interaction, () =>
        interaction.deferReply({ flags: MessageFlags.Ephemeral }),
      );
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('RESOLVE_DISPUTE', actor);
      if (payload.disputeId === undefined) throw new Error('Missing dispute ID');
      const action = payload.action === 'RESOLVE' ? 'FORCE_REPLACE' : 'REJECT';
      await this.steamAdminService.resolveDispute(
        payload.disputeId,
        action,
        interaction.user.id,
        interaction.id,
      );
      await interaction.editReply({
        content:
          action === 'FORCE_REPLACE'
            ? 'Dispute resolved; Steam account assigned.'
            : 'Dispute rejected.',
      });
      return;
    }
    throw new Error('Unsupported steam account control');
  }

  private async handleResultDispute(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseResultDisputeCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (payload.action === 'REPORT') {
      const modalCustomId = createResultDisputeCustomId(
        {
          action: 'MODAL',
          guildId: payload.guildId,
          actorDiscordUserId: interaction.user.id,
          matchId: payload.matchId,
        },
        this.options.componentSigningSecret,
      );
      await interaction.showModal(buildResultDisputeModal(modalCustomId));
      return;
    }
    if (payload.action === 'RES') {
      if (payload.actorDiscordUserId !== interaction.user.id)
        throw new Error('Administrative confirmation does not belong to this interaction');
      if (payload.disputeId === undefined || payload.resolution === undefined)
        throw new Error('Missing dispute resolution fields');
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('RESOLVE_DISPUTE', actor);
      const modalCustomId = createResultDisputeCustomId(
        {
          action: 'RSM',
          guildId: payload.guildId,
          actorDiscordUserId: interaction.user.id,
          matchId: payload.matchId,
          disputeId: payload.disputeId,
          resolution: payload.resolution,
        },
        this.options.componentSigningSecret,
      );
      await interaction.showModal(buildResultResolutionModal(modalCustomId, payload.resolution));
      return;
    }
    throw new Error('Unsupported result-dispute control');
  }

  private async handlePlayerHub(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parsePlayerHubCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    const componentsV2 = interaction.message.flags.has(MessageFlags.IsComponentsV2);
    if (
      payload.actorDiscordUserId !== interaction.user.id &&
      !(componentsV2 && payload.actorDiscordUserId === PUBLIC_PANEL_ACTOR_PLACEHOLDER)
    )
      throw new Error('Player Hub control does not belong to this interaction');
    if (componentsV2) {
      await this.ephemeralReplies.replace(interaction, () =>
        interaction.deferReply({ flags: MessageFlags.Ephemeral }),
      );
    } else {
      await interaction.deferUpdate();
    }
    if (payload.action === 'HISTORY') {
      const matches = await this.matchHistory.recentMatches(payload.guildId, interaction.user.id);
      await interaction.editReply(
        buildHistoryResponse(
          matches,
          interaction.user.id,
          false,
          payload.guildId,
          interaction.user.id,
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    if (payload.action === 'STATS') {
      const stats = await this.options.prisma.playerGuildStats.findUnique({
        where: {
          guildId_discordUserId: {
            guildId: payload.guildId,
            discordUserId: interaction.user.id,
          },
        },
      });
      const embed = new EmbedBuilder().setTitle('Match Stats').setColor(0x5865f2);
      if (stats === null) {
        embed.setDescription('You have no match statistics yet.');
      } else {
        embed.setDescription('Your competitive record on this server.').addFields(
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
    await this.renderPlayerHub(interaction, payload.guildId);
  }

  private async renderPlayerHub(
    interaction: MessageComponentInteraction,
    guildId: string,
  ): Promise<void> {
    const [status, queue, match] = await Promise.all([
      this.playerStatusService.getStatus(guildId, interaction.user.id),
      this.options.prisma.tenManQueue.findUnique({ where: { guildId } }),
      this.options.prisma.match.findFirst({
        where: {
          guildId,
          guildSlotActive: true,
          players: { some: { discordUserId: interaction.user.id } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const response = buildMatchCenterResponse(
      status,
      guildId,
      interaction.user.id,
      queue?.version ?? 0,
      match?.version ?? 0,
      match?.phaseGeneration ?? 0,
      this.options.componentSigningSecret,
    );
    await interaction.editReply(response);
  }

  private async handleQueue(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseQueueCustomId(interaction.customId, this.options.componentSigningSecret);
    if (payload.guildId !== interaction.guildId)
      throw new Error('Queue does not belong to this guild');

    // Non-mutating controls stay usable on a stale panel.
    if (payload.action === 'HOW_IT_WORKS') {
      await this.ephemeralReplies.reply(interaction, {
        flags: MessageFlags.Ephemeral,
        content: howItWorksText(),
      });
      return;
    }
    if (payload.action === 'REFRESH') {
      await interaction.deferUpdate();
      await this.queuePanelService.reconcile(payload.guildId);
      return;
    }

    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId: payload.guildId },
      include: { entries: { orderBy: { joinedAt: 'asc' } } },
    });
    if (queue === null || queue.version !== payload.version) {
      await this.renderStaleRefresh(interaction, payload.guildId);
      return;
    }

    await this.ephemeralReplies.replace(interaction, () =>
      interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    );

    if (payload.action === 'JOIN') {
      const result = await this.queueService.join({
        guildId: payload.guildId,
        discordUserId: interaction.user.id,
        displayName: interaction.user.globalName ?? interaction.user.username,
        correlationId: interaction.id,
      });
      await this.renderQueueJoinResponse(interaction, payload.guildId, result);
      if (result.status === 'joined') {
        await this.queueAlertService.maybeSendQueueAlert(
          payload.guildId,
          result.playersInQueue,
          result.queueSize,
        );
      }
      return;
    }

    if (payload.action === 'LEAVE') {
      const entry = queue.entries.find(
        (candidate) => candidate.discordUserId === interaction.user.id,
      );
      if (entry !== undefined && entry.partyId !== null) {
        const partySize = queue.entries.filter(
          (candidate) => candidate.partyId === entry.partyId,
        ).length;
        await interaction.editReply({
          content: [
            '**Remove your party from the queue?**',
            `This will remove all ${String(partySize)} members of your party from the current queue.`,
          ].join('\n'),
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  createQueueCustomId(
                    { action: 'LEAVE_CONFIRM', guildId: payload.guildId, version: queue.version },
                    this.options.componentSigningSecret,
                  ),
                )
                .setLabel('Remove Party')
                .setStyle(ButtonStyle.Danger),
              matchCenterButton(
                payload.guildId,
                interaction.user.id,
                this.options.componentSigningSecret,
                'Cancel',
              ),
            ),
          ],
        });
        return;
      }
      await this.queueService.leave(payload.guildId, interaction.user.id, interaction.id);
      await interaction.editReply(await this.buildLeftQueueReply(payload.guildId, false));
      return;
    }

    await this.queueService.leave(payload.guildId, interaction.user.id, interaction.id);
    await interaction.editReply(await this.buildLeftQueueReply(payload.guildId, true));
  }

  private async buildLeftQueueReply(
    guildId: string,
    wasParty: boolean,
  ): Promise<{ content: string; components: ActionRowBuilder<ButtonBuilder>[] }> {
    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId },
      select: { version: true },
    });
    return {
      content: wasParty ? 'Your party was removed from the queue.' : 'You left the queue.',
      components:
        queue === null
          ? []
          : [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                joinQueueButton(
                  guildId,
                  queue.version,
                  this.options.componentSigningSecret,
                  'Join Queue Again',
                ),
              ),
            ],
    };
  }

  private async renderQueueJoinResponse(
    interaction: MessageComponentInteraction,
    guildId: string,
    result: Awaited<ReturnType<QueueService['join']>>,
  ): Promise<void> {
    const secret = this.options.componentSigningSecret;
    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId },
      include: { entries: { orderBy: { joinedAt: 'asc' } } },
    });
    const version = queue?.version ?? 0;
    const hubAndLeave = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        matchCenterButton(guildId, interaction.user.id, secret),
        leaveQueueButton(guildId, version, secret),
      ),
    ];
    const hubAndRefresh = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        matchCenterButton(guildId, interaction.user.id, secret),
        queueRefreshButton(guildId, version, secret),
      ),
    ];
    switch (result.status) {
      case 'joined': {
        const needed = result.queueSize - result.playersInQueue;
        await interaction.editReply({
          content:
            result.promotedMatchId === undefined
              ? [
                  "**You're in the queue**",
                  `Players: ${String(result.playersInQueue)} / ${String(result.queueSize)}`,
                  `Needed: ${String(needed)}`,
                  `You'll receive a ready check when the queue reaches ${String(result.queueSize)} players.`,
                ].join('\n')
              : '**Queue full — ready check has started.** Watch for the ready prompt.',
          components:
            result.promotedMatchId === undefined
              ? hubAndLeave
              : [
                  new ActionRowBuilder<ButtonBuilder>().addComponents(
                    matchCenterButton(guildId, interaction.user.id, secret),
                  ),
                ],
        });
        return;
      }
      case 'already_queued': {
        const position =
          (queue?.entries.findIndex((entry) => entry.discordUserId === interaction.user.id) ?? -1) +
          1;
        await interaction.editReply({
          content: [
            "**You're already in the queue**",
            position > 0 ? `Position: ${String(position)}` : null,
            `Players: ${String(result.playersInQueue)} / ${String(result.queueSize)}`,
          ]
            .filter((line): line is string => line !== null)
            .join('\n'),
          components: hubAndLeave,
        });
        return;
      }
      case 'missing_steam':
        await interaction.editReply({
          content:
            result.memberCount > 1
              ? [
                  "**Party can't join yet**",
                  'Every party member must have a Steam account assigned before the party can queue.',
                  `Still needed: ${result.missingDisplayNames.join(', ')}`,
                ].join('\n')
              : [
                  '**Steam account needed**',
                  'Assign the Steam account you plan to use before joining the queue.',
                ].join('\n'),
          components: buildSteamAccountButton(
            guildId,
            interaction.user.id,
            this.options.componentSigningSecret,
          ),
        });
        return;
      case 'queue_banned':
        await interaction.editReply({
          content: [
            "**You can't join this queue right now**",
            result.expiresAt === null
              ? null
              : `Available again: <t:${String(Math.floor(result.expiresAt.getTime() / 1000))}:f>`,
            `Reason: ${result.reason}`,
          ]
            .filter((line): line is string => line !== null)
            .join('\n'),
        });
        return;
      case 'queue_unavailable':
      case 'active_match':
        await interaction.editReply({
          content: [
            '**Queue unavailable**',
            'A competitive match is currently being formed or played. The queue will reopen automatically afterward.',
          ].join('\n'),
          components: hubAndRefresh,
        });
        return;
      case 'queue_full':
        await interaction.editReply({
          content: [
            '**Queue just filled**',
            'Another player filled the final slot before your request completed.',
          ].join('\n'),
          components: hubAndRefresh,
        });
        return;
      case 'parties_disabled':
        await interaction.editReply({ content: 'Parties are disabled for this queue.' });
        return;
      case 'party_forbidden':
        await interaction.editReply({ content: 'Only the party leader can queue the party.' });
        return;
      case 'party_guild_mismatch':
        await interaction.editReply({ content: 'That party belongs to a different server.' });
        return;
      case 'party_partially_queued':
        await interaction.editReply({
          content: 'Your party has inconsistent queue entries. Leave queue and try again.',
        });
        return;
      case 'party_duplicate_steam':
        await interaction.editReply({
          content: 'Party members must have distinct assigned Steam accounts.',
        });
        return;
      default:
        await interaction.editReply({ content: 'Unable to join the queue right now.' });
    }
  }

  private async handleMatchOps(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseMatchOpsCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (payload.actorDiscordUserId !== interaction.user.id)
      throw new Error('Administrative control does not belong to this interaction');
    const match = await this.options.prisma.match.findUnique({
      where: { id: payload.matchId },
      include: { players: { select: { discordUserId: true } } },
    });
    if (
      match === null ||
      match.guildId !== interaction.guildId ||
      match.version !== payload.version ||
      match.phaseGeneration !== payload.phaseGeneration
    ) {
      await this.ephemeralReplies.reply(interaction, {
        flags: MessageFlags.Ephemeral,
        content:
          "That action isn't available anymore because the match has moved to the next stage.",
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: createPlayerHubCustomId(
                  {
                    action: 'HUB',
                    guildId: interaction.guildId,
                    actorDiscordUserId: interaction.user.id,
                  },
                  this.options.componentSigningSecret,
                ),
                label: 'Match Center',
              },
            ],
          },
        ],
      });
      return;
    }
    const confirm = (kind: 'restart' | 'cancel' | 'rollback') => ({
      content:
        kind === 'restart'
          ? 'This clears the current forming-phase progress. Confirm within five minutes.'
          : kind === 'cancel'
            ? `This cancels match ${match.id.slice(0, 8)} and starts cleanup if needed. Confirm within five minutes.`
            : `This reverses the rating ledger for match ${match.id.slice(0, 8)}. Confirm within five minutes.`,
      components: (kind === 'restart'
        ? buildRestartPhaseConfirmationControls
        : kind === 'cancel'
          ? buildCancelMatchConfirmationControls
          : buildRollbackConfirmationControls)(
        {
          matchId: match.id,
          version: match.version,
          phaseGeneration: match.phaseGeneration,
          actorDiscordUserId: interaction.user.id,
          expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
        },
        this.options.componentSigningSecret,
      ),
    });
    if (payload.action === 'RF') {
      await interaction.deferUpdate();
      await interaction.editReply(
        buildAdminMatchPanel(
          match,
          interaction.guildId,
          interaction.user.id,
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    if (payload.action === 'RP' || payload.action === 'ST') {
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized(payload.action === 'RP' ? 'RESTART_PHASE' : 'STOP', actor, {
        leaderDiscordUserId: match.leaderDiscordUserId,
        state: match.state,
      });
      await interaction.update(confirm(payload.action === 'RP' ? 'restart' : 'cancel'));
      return;
    }
    if (payload.action === 'RB') {
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('ROLLBACK_MATCH', actor);
      await interaction.update(confirm('rollback'));
      return;
    }
    if (payload.action === 'FR') {
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('FORCE_READY', actor);
      await interaction.deferUpdate();
      await this.matchAdmin.forceReady(
        match.id,
        payload.version,
        interaction.user.id,
        interaction.id,
      );
      await interaction.editReply(
        buildAdminMatchPanel(
          {
            ...match,
            state: 'TEAM_SELECTION',
            version: match.version + 1,
            phaseGeneration: match.phaseGeneration + 1,
          },
          interaction.guildId,
          interaction.user.id,
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    if (payload.action === 'RO') {
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('REPLACE_PARTICIPANT', actor);
      if (!interaction.isUserSelectMenu()) throw new Error('Player selection is missing');
      const outgoing = interaction.values[0];
      if (outgoing === undefined) throw new Error('Player selection is missing');
      await interaction.update(
        buildReplaceIncomingSelect(
          match,
          interaction.guildId,
          interaction.user.id,
          outgoing,
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized('REPLACE_PARTICIPANT', actor);
    if (!interaction.isUserSelectMenu()) throw new Error('Player selection is missing');
    if (payload.targetDiscordUserId === undefined)
      throw new Error('Outgoing participant selection is missing');
    const incoming = interaction.values[0];
    if (incoming === undefined) throw new Error('Player selection is missing');
    await interaction.deferUpdate();
    await this.matchAdmin.replaceParticipant({
      matchId: match.id,
      outgoingDiscordUserId: payload.targetDiscordUserId,
      incomingDiscordUserId: incoming,
      expectedVersion: payload.version,
      actorDiscordUserId: interaction.user.id,
      correlationId: interaction.id,
    });
    await interaction.editReply({
      content: `Replaced <@${payload.targetDiscordUserId}> with <@${incoming}>; the ready deadline was restarted.`,
      components: [],
      embeds: [],
    });
  }

  private async handleAdminPanel(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseAdminPanelCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (payload.guildId !== interaction.guildId)
      throw new Error('Admin panel control does not belong to this guild');
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized(
      payload.action === 'CONFIGURE' || payload.action === 'MAPS'
        ? 'CONFIGURE_GUILD'
        : payload.action === 'MODERATORS'
          ? 'MANAGE_MATCH_MODERATORS'
          : 'OPERATE_QUEUE',
      actor,
    );
    if (payload.action === 'CONFIGURE') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const settings = await this.options.prisma.tenManSettings.findUnique({
        where: { guildId: payload.guildId },
        select: {
          version: true,
          teamSelectionMode: true,
          mapSelectionMode: true,
          defaultServerLocation: true,
        },
      });
      if (settings === null) throw new Error('Competitive configuration is not available');
      const draft = configurationDraftFromSettings(settings);
      await interaction.editReply(
        buildAdminQueueConfiguration(
          { guildId: payload.guildId, actorDiscordUserId: interaction.user.id, ...draft },
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    if (payload.action === 'MODERATORS') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(
        buildMatchModeratorPanel(
          payload.guildId,
          interaction.user.id,
          await this.matchModeratorService.list(payload.guildId),
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    if (payload.action === 'MAPS') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(
        await this.buildMapPoolResponse(payload.guildId, interaction.user.id, 0),
      );
      return;
    }
    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId: payload.guildId },
      select: { version: true },
    });
    if (payload.action !== 'REFRESH' && payload.version !== (queue?.version ?? 0))
      throw new Error('Admin panel is stale; refresh and try again.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (payload.action === 'OPEN') {
      await this.queueService.openEnrollment({
        guildId: payload.guildId,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
      await this.reconcileLobbyQueuePanel(payload.guildId);
      await this.adminPanelService.reconcile(payload.guildId);
      await interaction.editReply({ content: 'Player enrollment is open.' });
      return;
    }
    if (payload.action === 'CLOSE') {
      await this.queueService.closeEnrollment({
        guildId: payload.guildId,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
      await this.reconcileLobbyQueuePanel(payload.guildId);
      await this.adminPanelService.reconcile(payload.guildId);
      await interaction.editReply({ content: 'Player enrollment is closed.' });
      return;
    }
    if (payload.action === 'REPAIR') {
      const settings = await this.options.prisma.tenManSettings.findUnique({
        where: { guildId: payload.guildId },
        select: { lobbyTextChannelId: true },
      });
      if (settings?.lobbyTextChannelId === null || settings?.lobbyTextChannelId === undefined)
        throw new Error('Lobby text channel is not configured');
      const channel = await this.options.discord.channels.fetch(settings.lobbyTextChannelId);
      if (channel === null || !channel.isTextBased() || channel.isDMBased())
        throw new Error('Configured lobby text channel is unavailable');
      await this.options.prisma.tenManQueue.upsert({
        where: { guildId: payload.guildId },
        update: {},
        create: { guildId: payload.guildId, status: 'DISABLED' },
      });
      await this.queuePanelService.reconcile(payload.guildId, channel);
      await this.adminPanelService.reconcile(payload.guildId);
      await interaction.editReply({ content: 'Match Queue panel repaired.' });
      return;
    }
    await this.adminPanelService.reconcile(payload.guildId);
    await interaction.editReply({ content: 'Match Queue Control refreshed.' });
  }

  private async handleMatchModerators(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null || !interaction.isUserSelectMenu())
      throw new Error('Guild user selection required');
    const payload = parseMatchModeratorCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (
      payload.guildId !== interaction.guildId ||
      payload.actorDiscordUserId !== interaction.user.id
    )
      throw new Error('Match Moderator control does not belong to this interaction');
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized('MANAGE_MATCH_MODERATORS', actor);
    const target = interaction.values[0];
    if (target === undefined) throw new Error('Match Moderator selection is missing');
    await interaction.deferUpdate();
    if (payload.action === 'ADD') {
      await this.matchModeratorService.add({
        guildId: payload.guildId,
        discordUserId: target,
        addedByDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
    } else {
      await this.matchModeratorService.remove({
        guildId: payload.guildId,
        discordUserId: target,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
    }
    await this.adminPanelService.reconcile(payload.guildId);
    await interaction.editReply(
      buildMatchModeratorPanel(
        payload.guildId,
        interaction.user.id,
        await this.matchModeratorService.list(payload.guildId),
        this.options.componentSigningSecret,
      ),
    );
  }

  private async handleMapPool(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseMapPoolCustomId(interaction.customId, this.options.componentSigningSecret);
    if (
      payload.guildId !== interaction.guildId ||
      payload.actorDiscordUserId !== interaction.user.id
    ) {
      throw new Error('Map-pool control does not belong to this interaction');
    }
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized('CONFIGURE_GUILD', actor);
    const settings = await this.options.prisma.tenManSettings.findUnique({
      where: { guildId: payload.guildId },
      select: { version: true },
    });
    if (settings === null || settings.version !== payload.settingsVersion)
      throw new Error('Configuration changed; reload and try again');

    if (payload.action === 'ADD') {
      const modalId = createMapPoolCustomId(
        { ...payload, action: 'ADD_SUBMIT' },
        this.options.componentSigningSecret,
      );
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Add Workshop Map')
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('workshop_map_name')
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                .setLabel('Canonical workshop map identifier')
                .setPlaceholder('workshop/123456789/de_example')
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('workshop_display_name')
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                .setLabel('Display name')
                .setPlaceholder('Example Workshop Map')
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
            ),
          ),
      );
      return;
    }
    if (payload.action === 'PREVIOUS' || payload.action === 'NEXT') {
      await interaction.update(
        await this.buildMapPoolResponse(payload.guildId, interaction.user.id, payload.page),
      );
      return;
    }
    if (payload.action === 'REMOVE') {
      if (!interaction.isStringSelectMenu()) throw new Error('Workshop map selection is missing');
      const mapName = interaction.values[0];
      if (mapName === undefined || mapName === 'none')
        throw new Error('Workshop map selection is missing');
      await interaction.deferUpdate();
      await this.mapPoolService.removeWorkshopMap({
        guildId: payload.guildId,
        mapName,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
      await this.adminPanelService.reconcile(payload.guildId);
      await interaction.editReply(
        await this.buildMapPoolResponse(payload.guildId, interaction.user.id, payload.page),
      );
      return;
    }
    if (payload.action === 'POOL') {
      if (!interaction.isStringSelectMenu()) throw new Error('Map pool selection is missing');
      const view = await this.getMapPoolView(payload.guildId, interaction.user.id, payload.page);
      const candidates = [...view.officialMaps, ...view.workshopMaps.map((map) => map.mapName)];
      const pageSize = 25;
      const pageCandidates = candidates.slice(
        payload.page * pageSize,
        (payload.page + 1) * pageSize,
      );
      const selected = new Set(interaction.values);
      const nextPool = [
        ...view.activePool.mapNames.filter((mapName) => !pageCandidates.includes(mapName)),
        ...pageCandidates.filter((mapName) => selected.has(mapName)),
      ];
      await interaction.deferUpdate();
      await this.mapPoolService.saveActiveMapPool({
        guildId: payload.guildId,
        mapNames: nextPool,
        expectedVersion: payload.settingsVersion,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
      });
      await this.adminPanelService.reconcile(payload.guildId);
      await interaction.editReply(
        await this.buildMapPoolResponse(payload.guildId, interaction.user.id, payload.page),
      );
      return;
    }
    throw new Error('Unsupported map-pool control');
  }

  private async buildMapPoolResponse(guildId: string, actorDiscordUserId: string, page: number) {
    return buildMapPoolManagement(
      await this.getMapPoolView(guildId, actorDiscordUserId, page),
      this.options.componentSigningSecret,
    );
  }

  private async getMapPoolView(guildId: string, actorDiscordUserId: string, page: number) {
    const settings = await this.options.prisma.tenManSettings.findUnique({
      where: { guildId },
      select: { version: true, defaultGameProfileKey: true },
    });
    if (settings === null) throw new Error('Competitive configuration is missing');
    const profile = await this.options.prisma.gameProfile.findUnique({
      where: { key: settings.defaultGameProfileKey ?? 'competitive_5v5' },
      select: { mapAllowlist: true },
    });
    if (profile === null) throw new Error('Configured game profile is missing');
    const workshopMaps = await this.mapPoolService.listWorkshopCatalog(guildId);
    const candidateCount =
      profile.mapAllowlist.filter((mapName) => mapName.startsWith('de_')).length +
      workshopMaps.length;
    const safePage = Math.min(page, Math.max(0, Math.ceil(candidateCount / 25) - 1));
    return {
      guildId,
      actorDiscordUserId,
      settingsVersion: settings.version,
      activePool: await this.mapPoolService.getActiveMapPool(guildId),
      officialMaps: profile.mapAllowlist.filter((mapName) => mapName.startsWith('de_')),
      workshopMaps,
      page: safePage,
    };
  }

  private async handleAdminQueueConfiguration(
    interaction: MessageComponentInteraction,
  ): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseAdminQueueConfigCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (
      payload.guildId !== interaction.guildId ||
      payload.actorDiscordUserId !== interaction.user.id
    )
      throw new Error('Queue configuration control does not belong to this interaction');
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized('CONFIGURE_GUILD', actor);

    if (payload.action === 'CANCEL') {
      await interaction.update({
        content: 'Queue configuration canceled.',
        embeds: [],
        components: [],
      });
      return;
    }
    if (payload.action === 'SAVE') {
      await interaction.deferUpdate();
      await this.guildSettingsService.updateQueueOptions({
        guildId: payload.guildId,
        actorDiscordUserId: interaction.user.id,
        correlationId: interaction.id,
        expectedVersion: payload.settingsVersion,
        defaultServerLocation:
          payload.location === 'L'
            ? 'los_angeles'
            : payload.location === 'V'
              ? 'virginia'
              : 'dallas',
        teamSelectionMode: payload.team === 'S' ? 'RANDOM' : 'CAPTAINS',
        mapSelectionMode: payload.map === 'R' ? 'RANDOM' : 'CAPTAIN_VETO',
      });
      await this.adminPanelService.reconcile(payload.guildId);
      await interaction.editReply({
        content: 'Queue configuration saved for future queues.',
        embeds: [],
        components: [],
      });
      return;
    }
    if (!interaction.isStringSelectMenu())
      throw new Error('Queue configuration selection is missing');
    const selected = interaction.values[0];
    if (selected === undefined) throw new Error('Queue configuration selection is missing');
    const draft = { ...payload };
    if (payload.action === 'TEAM' && (selected === 'C' || selected === 'S')) draft.team = selected;
    else if (payload.action === 'MAP' && (selected === 'V' || selected === 'R'))
      draft.map = selected;
    else if (
      payload.action === 'LOCATION' &&
      (selected === 'D' || selected === 'L' || selected === 'V')
    )
      draft.location = selected;
    else throw new Error('Invalid queue configuration selection');
    await interaction.update(
      buildAdminQueueConfiguration(
        {
          guildId: draft.guildId,
          actorDiscordUserId: draft.actorDiscordUserId,
          settingsVersion: draft.settingsVersion,
          team: draft.team,
          map: draft.map,
          location: draft.location,
        },
        this.options.componentSigningSecret,
      ),
    );
  }

  private async reconcileLobbyQueuePanel(guildId: string): Promise<void> {
    const settings = await this.options.prisma.tenManSettings.findUnique({
      where: { guildId },
      select: { lobbyTextChannelId: true },
    });
    if (settings?.lobbyTextChannelId === null || settings?.lobbyTextChannelId === undefined)
      throw new Error('Lobby text channel is not configured');
    const channel = await this.options.discord.channels.fetch(settings.lobbyTextChannelId);
    if (channel === null || !channel.isTextBased() || channel.isDMBased())
      throw new Error('Configured lobby text channel is unavailable');
    await this.queuePanelService.reconcile(guildId, channel);
  }

  private async handleQueueAdmin(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseQueueAdminCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (payload.guildId !== interaction.guildId)
      throw new Error('Queue control does not belong to this guild');
    if (payload.actorDiscordUserId !== interaction.user.id)
      throw new Error('Administrative control does not belong to this interaction');
    const actor = await this.options.adminActorFor(interaction);
    if (payload.action === 'BAN_SELECT') {
      assertAuthorized('QUEUE_BAN', actor);
      if (!interaction.isUserSelectMenu()) throw new Error('Player selection is missing');
      const target = interaction.values[0];
      if (target === undefined) throw new Error('Player selection is missing');
      const modalCustomId = createQueueAdminCustomId(
        {
          action: 'BAN_MODAL',
          guildId: payload.guildId,
          actorDiscordUserId: interaction.user.id,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          targetDiscordUserId: target,
        },
        this.options.componentSigningSecret,
      );
      await interaction.showModal(buildQueueBanModal(modalCustomId));
      return;
    }
    if (payload.action === 'UNBAN') {
      assertAuthorized('QUEUE_UNBAN', actor);
      if (!interaction.isUserSelectMenu()) throw new Error('Player selection is missing');
      const target = interaction.values[0];
      if (target === undefined) throw new Error('Player selection is missing');
      await interaction.deferUpdate();
      await this.queueBanService.unban(
        payload.guildId,
        target,
        interaction.user.id,
        interaction.id,
      );
      const [queue, bans] = await Promise.all([
        this.options.prisma.tenManQueue.findUnique({
          where: { guildId: payload.guildId },
          include: { entries: { select: { discordUserId: true } } },
        }),
        this.options.prisma.tenManQueueBan.findMany({
          where: { guildId: payload.guildId, revokedAt: null },
          select: { discordUserId: true, reason: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
      ]);
      await interaction.editReply(
        buildAdminQueuePanel(
          queue,
          bans,
          payload.guildId,
          interaction.user.id,
          this.options.componentSigningSecret,
        ),
      );
      return;
    }
    throw new Error('Unsupported queue administration control');
  }

  private async handleParty(interaction: MessageComponentInteraction): Promise<void> {
    const payload = parsePartyCustomId(interaction.customId, this.options.componentSigningSecret);
    if (payload.actorDiscordUserId !== interaction.user.id)
      throw new Error('Party control does not belong to this interaction');
    const guildId = interaction.guildId ?? payload.guildId;
    if (payload.action === 'ACCEPT') {
      if (payload.inviteId === undefined) throw new Error('Missing party invitation');
      await this.ephemeralReplies.replace(interaction, () =>
        interaction.deferReply({ flags: MessageFlags.Ephemeral }),
      );
      await this.partyService.accept(payload.inviteId, interaction.user.id);
      await interaction.editReply({ content: 'Party invitation accepted. Welcome aboard.' });
      return;
    }
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    if (payload.action === 'INVITE' || payload.action === 'KICK') {
      if (payload.partyId === undefined) throw new Error('Missing party reference');
      if (!interaction.isUserSelectMenu()) throw new Error('Player selection is missing');
      const target = interaction.values[0];
      if (target === undefined) throw new Error('Player selection is missing');
      await interaction.deferUpdate();
      if (payload.action === 'INVITE') {
        const inviteId = await this.partyService.invite(
          payload.partyId,
          interaction.user.id,
          target,
        );
        const invitee = await this.options.discord.users.fetch(target).catch(() => null);
        const delivered =
          invitee === null
            ? false
            : await invitee
                .send({
                  content: `<@${interaction.user.id}> invited you to their team. Accept within 15 minutes.`,
                  components: buildPartyInviteAcceptRows(
                    guildId,
                    target,
                    [{ id: inviteId }],
                    this.options.componentSigningSecret,
                  ),
                })
                .then(() => true)
                .catch(() => false);
        if (!delivered) {
          await interaction.editReply({
            content: `Invitation created for <@${target}>. Their DMs are unavailable; they can accept it from their **/match team** panel.`,
            components: [],
            embeds: [],
          });
          return;
        }
      } else {
        await this.partyService.kick(payload.partyId, interaction.user.id, target);
      }
      await this.renderPartyPanel(interaction, guildId);
      return;
    }
    await interaction.deferUpdate();
    if (payload.action === 'CREATE') {
      await this.partyService.create(guildId, interaction.user.id);
    } else if (payload.action === 'LEAVE' || payload.action === 'DISBAND') {
      if (payload.partyId === undefined) throw new Error('Missing party reference');
      if (payload.action === 'LEAVE')
        await this.partyService.leave(payload.partyId, interaction.user.id);
      else await this.partyService.disband(payload.partyId, interaction.user.id);
    }
    await this.renderPartyPanel(interaction, guildId);
  }

  private async renderPartyPanel(
    interaction: MessageComponentInteraction,
    guildId: string,
  ): Promise<void> {
    const state = await this.partyService.getPanelState(guildId, interaction.user.id);
    await interaction.editReply(
      buildPartyPanelResponse(
        state,
        guildId,
        interaction.user.id,
        this.options.componentSigningSecret,
      ),
    );
  }

  private async renderStaleRefresh(
    interaction: MessageComponentInteraction,
    guildId: string,
  ): Promise<void> {
    await interaction.deferUpdate();
    await this.queuePanelService.reconcile(guildId);
  }

  private async handleMatchAdmin(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    await interaction.deferUpdate();
    const payload = parseMatchAdminCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (payload.actorDiscordUserId !== interaction.user.id)
      throw new Error('Administrative confirmation does not belong to this interaction');
    const match = await this.options.prisma.match.findUnique({ where: { id: payload.matchId } });
    if (
      match === null ||
      match.guildId !== interaction.guildId ||
      match.version !== payload.version ||
      match.phaseGeneration !== payload.phaseGeneration
    )
      throw new Error('Administrative confirmation is stale');
    if (payload.action === 'RX' || payload.action === 'RC' || payload.action === 'CC') {
      await interaction.editReply({ content: 'Administrative action canceled.', components: [] });
      return;
    }
    if (payload.action === 'RB') {
      const actor = await this.options.adminActorFor(interaction);
      assertAuthorized('ROLLBACK_MATCH', actor);
      await this.matchHistory.rollbackResult(match.id, interaction.user.id, interaction.id);
      await interaction.editReply({
        content: 'Match rating result was rolled back.',
        components: [],
      });
      return;
    }
    if (payload.action === 'CA') {
      await this.options.matchService.cancel(
        match.id,
        await this.options.actorFor(interaction, match.id),
        interaction.id,
      );
      await interaction.editReply({
        content: 'Match canceled. Cleanup status is available in `/match center`.',
        components: [],
      });
      return;
    }
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized('RESTART_PHASE', actor);
    await this.matchAdmin.restartFormingPhase(
      match.id,
      payload.version,
      interaction.user.id,
      interaction.id,
    );
    await interaction.editReply({
      content: 'Current forming phase was restarted.',
      components: [],
    });
  }

  private async handlePlayerAdmin(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    await interaction.deferUpdate();
    const payload = parsePlayerAdminCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
    if (
      payload.guildId !== interaction.guildId ||
      payload.actorDiscordUserId !== interaction.user.id
    )
      throw new Error('Administrative confirmation does not belong to this interaction');
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized('RESET_PLAYER_STATS', actor);
    if (payload.action === 'SEL') {
      if (!interaction.isUserSelectMenu()) throw new Error('Player selection is missing');
      const target = interaction.values[0];
      if (target === undefined) throw new Error('Player selection is missing');
      await interaction.editReply({
        content: `This resets <@${target}>'s current rating and record. Match history is retained. Confirm within five minutes.`,
        components: buildPlayerStatsResetConfirmationControls(
          {
            guildId: payload.guildId,
            targetDiscordUserId: target,
            actorDiscordUserId: interaction.user.id,
            expiresAt: Math.floor(Date.now() / 1000) + 5 * 60,
          },
          this.options.componentSigningSecret,
        ),
      });
      return;
    }
    if (payload.action === 'RC') {
      await interaction.editReply({ content: 'Statistics reset canceled.', components: [] });
      return;
    }
    await this.matchAdmin.resetPlayerStats(
      payload.guildId,
      payload.targetDiscordUserId,
      interaction.user.id,
      interaction.id,
    );
    await interaction.editReply({ content: 'Player statistics were reset.', components: [] });
  }

  private async handleAdmin(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    await interaction.deferUpdate();
    const payload = parseAdminCustomId(interaction.customId, this.options.componentSigningSecret);
    if (
      payload.guildId !== interaction.guildId ||
      payload.actorDiscordUserId !== interaction.user.id
    )
      throw new Error('Administrative confirmation does not belong to this interaction');
    const actor = await this.options.adminActorFor(interaction);
    assertAuthorized(
      payload.action === 'TC' || payload.action === 'TX' ? 'TEARDOWN_GUILD' : 'RECOVER_GUILD_SETUP',
      actor,
    );
    if (payload.action === 'TX' || payload.action === 'RX') {
      await interaction.editReply({ content: 'Administrative action canceled.', components: [] });
      return;
    }
    const preview =
      payload.action === 'TC'
        ? await this.options.guildResourceService.teardownPreview(interaction.guildId)
        : await this.options.guildResourceService.recoverPreview(interaction.guildId);
    if (
      preview.settingsVersion !== payload.settingsVersion ||
      adminGeneration(preview.attemptId, preview.settingsVersion) !== payload.generation
    )
      throw new Error('Administrative confirmation is stale');
    if (payload.action === 'TC') {
      await this.options.guildResourceService.teardown(
        interaction.guildId,
        interaction.user.id,
        interaction.id,
        payload.settingsVersion,
      );
      await interaction.editReply({
        content:
          'Managed competitive channels were archived and locked. A Discord administrator may delete them manually if desired.',
        components: [],
      });
      return;
    }
    await this.options.guildResourceService.recoverSetup(
      interaction.guildId,
      interaction.user.id,
      interaction.id,
      payload.settingsVersion,
    );
    await interaction.editReply({
      content: 'Managed setup recovery completed. You can run `/match config setup` again.',
      components: [],
    });
  }
}

function howItWorksText(): string {
  return [
    '**How Office Club Competitive works**',
    '',
    '1. Assign the Steam account you plan to use.',
    '2. Join the queue.',
    '3. When 10 players join, everyone receives a ready check.',
    '4. Teams are formed.',
    '5. Captains select/ban maps when required.',
    '6. The match server is prepared automatically.',
    '7. Open **My Match Info** when the server is ready.',
  ].join('\n');
}

export function buildSteamAccountStatusResponse(
  active: { steamId64: string; assignedAt: Date } | null,
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): {
  content: string;
  components: { type: 1; components: object[] }[];
} {
  const assignButton = {
    type: 2,
    style: 1,
    custom_id: createSteamAccountCustomId({ action: 'OPEN', guildId, actorDiscordUserId }, secret),
    label: active === null ? 'Assign Steam Account' : 'Change Steam Account',
  };
  if (active === null) {
    return {
      content: [
        'You do not have an assigned Steam account.',
        'Assign the Steam account you intend to use for Office Club Competitive matches.',
      ].join('\n'),
      components: [{ type: 1, components: [assignButton] }],
    };
  }
  const removeButton = {
    type: 2,
    style: 4,
    custom_id: createSteamAccountCustomId(
      { action: 'REMOVE', guildId, actorDiscordUserId },
      secret,
    ),
    label: 'Remove Assignment',
  };
  return {
    content: [
      'Assigned Steam account:',
      `**SteamID64:** \`${active.steamId64}\``,
      `Assigned <t:${String(Math.floor(active.assignedAt.getTime() / 1000))}:R>.`,
      '',
      'This association is used for roster building only. It does not verify Steam ownership.',
    ].join('\n'),
    components: [{ type: 1, components: [assignButton, removeButton] }],
  };
}
