import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
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
import { PlayerStatusService } from '../services/player-status-service.js';
import type { SteamAccountService } from '../services/steam-account-service.js';
import { SteamAdminService } from '../services/steam-admin-service.js';
import type { SteamProfileService } from '../services/steam-profile-service.js';
import { MatchResultDisputeService } from '../services/match-result-dispute-service.js';
import { QueueAlertService } from '../services/queue-alert-service.js';
import { adminGeneration, parseAdminCustomId } from './admin-custom-id.js';
import { parseMatchCustomId } from './match-custom-id.js';
import { createQueueCustomId, parseQueueCustomId } from './queue-custom-id.js';
import {
  joinQueueButton,
  leaveQueueButton,
  myTenManButton,
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
import { buildPlayerHubResponse } from './player-hub-components.js';
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

/** Routes signed first-release match-dashboard interactions. */
export class MatchInteractionRouter {
  private readonly readyCheckService: ReadyCheckService;
  private readonly captainService: CaptainService;
  private readonly draftService: DraftService;
  private readonly vetoService: VetoService;

  public constructor(private readonly options: InteractionRouterOptions) {
    this.readyCheckService = new ReadyCheckService(options.prisma);
    this.captainService = new CaptainService(options.prisma);
    this.draftService = new DraftService(options.prisma);
    this.vetoService = new VetoService(options.prisma);
  }

  public async handle(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseMatchCustomId(interaction.customId, this.options.componentSigningSecret);
    await interaction.deferReply({ ephemeral: true });
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

/** Owns every supported 10man component namespace. */
export class TenManComponentInteractionRouter {
  private readonly match: MatchInteractionRouter;
  private readonly queueService: QueueService;
  private readonly queuePanelService: QueuePanelService;
  private readonly matchHistory: MatchHistoryService;
  private readonly matchAdmin: MatchAdminService;
  private readonly playerStatusService: PlayerStatusService;
  private readonly steamAdminService: SteamAdminService;
  private readonly resultDisputeService: MatchResultDisputeService;
  private readonly queueAlertService: QueueAlertService;
  private readonly partyService: PartyService;
  private readonly queueBanService: QueueBanService;

  public constructor(private readonly options: TenManComponentInteractionRouterOptions) {
    this.match = new MatchInteractionRouter(options);
    this.queueService = new QueueService(options.prisma);
    this.queuePanelService = new QueuePanelService(
      options.prisma,
      options.discord,
      options.componentSigningSecret,
    );
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
    if (interaction.customId.startsWith('tpy:')) return this.handleParty(interaction);
    if (interaction.customId.startsWith('tmm:')) return this.match.handle(interaction);
    if (interaction.customId.startsWith('tmq:')) return this.handleQueue(interaction);
    if (interaction.customId.startsWith('tmp:')) return this.handlePlayerHub(interaction);
    if (interaction.customId.startsWith('tms:')) return this.handleSteamAccount(interaction);
    if (interaction.customId.startsWith('tmd:')) return this.handleResultDispute(interaction);
    if (interaction.customId.startsWith('tma:')) return this.handleAdmin(interaction);
    throw new Error('Unsupported 10man component namespace');
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
          await interaction.reply({
            content: buildAssignmentSuccessResponse(result.steamId64, result.displayName),
            ephemeral: true,
          });
          return;
        case 'duplicate':
          await interaction.reply({
            ephemeral: true,
            ...buildDuplicateAssignmentResponse(
              payload.guildId,
              interaction.user.id,
              result.steamId64,
              this.options.componentSigningSecret,
            ),
          });
          return;
        case 'invalid_input':
          await interaction.reply({ content: buildInvalidInputResponse(), ephemeral: true });
          return;
        case 'api_unavailable':
          await interaction.reply({ content: buildApiUnavailableResponse(), ephemeral: true });
          return;
        case 'locked':
          await interaction.reply({
            content: buildLockedAssignmentResponse(result.reason),
            ephemeral: true,
          });
          return;
      }
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
        await interaction.reply({
          content: buildResultDisputeAcknowledgedResponse(result.id),
          ephemeral: true,
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
        await interaction.reply({
          ephemeral: true,
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
      await interaction.reply({
        ephemeral: true,
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
      await interaction.reply({
        content: buildDisputeAcknowledgedResponse(id),
        ephemeral: true,
      });
      return;
    }
    if (payload.action === 'VIEW') {
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
    await interaction.deferReply({ ephemeral: true });
    const payload = parsePlayerHubCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
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
      const embed = new EmbedBuilder().setTitle('10man Stats').setColor(0x5865f2);
      if (stats === null) {
        embed.setDescription('You have no match statistics yet.');
      } else {
        embed.setDescription('Your 10man record on this server.').addFields(
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
    const response = buildPlayerHubResponse(
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
      await interaction.reply({ ephemeral: true, content: howItWorksText() });
      return;
    }
    if (payload.action === 'REFRESH') {
      await interaction.deferReply({ ephemeral: true });
      await this.queuePanelService.reconcile(payload.guildId);
      const status = await this.playerStatusService.getStatus(
        payload.guildId,
        interaction.user.id,
      );
      await interaction.editReply({
        content:
          status.kind === 'READY_CHECK'
            ? "Queue status refreshed. You're now in a ready check."
            : status.kind === 'MATCH_ACTIVE'
              ? 'Queue status refreshed. Your match is in progress.'
              : 'Queue status refreshed.',
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            myTenManButton(payload.guildId, interaction.user.id, this.options.componentSigningSecret),
          ),
        ],
      });
      return;
    }

    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId: payload.guildId },
      include: { entries: { orderBy: { joinedAt: 'asc' } } },
    });
    if (queue === null || queue.version !== payload.version) {
      await this.renderStaleRefresh(interaction, payload.guildId, queue?.version ?? null);
      return;
    }

    await interaction.deferReply({ ephemeral: true });

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
              myTenManButton(
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
              joinQueueButton(guildId, queue.version, this.options.componentSigningSecret, 'Join Queue Again'),
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
        myTenManButton(guildId, interaction.user.id, secret),
        leaveQueueButton(guildId, version, secret),
      ),
    ];
    const hubAndRefresh = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        myTenManButton(guildId, interaction.user.id, secret),
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
                  myTenManButton(guildId, interaction.user.id, secret),
                ),
              ],
        });
        return;
      }
      case 'already_queued': {
        const position =
          (queue?.entries.findIndex(
            (entry) => entry.discordUserId === interaction.user.id,
          ) ?? -1) + 1;
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
            'A 10man is currently being formed or played. The queue will reopen automatically afterward.',
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
      await interaction.reply({
        ephemeral: true,
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
                label: 'Refresh My 10man',
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
      await interaction.reply({ ephemeral: true, ...confirm('rollback') });
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
      await interaction.deferReply({ ephemeral: true });
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
                  content: `<@${interaction.user.id}> invited you to their 10man party. Accept within 15 minutes.`,
                  components: buildPartyInviteAcceptRows(
                    guildId,
                    target,
                    [{ id: inviteId }],
                    this.options.componentSigningSecret,
                  ),
                })
                .then(() => true)
                .catch(() => false);
        await interaction.followUp({
          ephemeral: true,
          content: delivered
            ? `Invitation sent to <@${target}>.`
            : `Invitation created for <@${target}>. Their DMs are unavailable; they can accept it from their **/10man party** panel.`,
        });
      } else {
        await this.partyService.kick(payload.partyId, interaction.user.id, target);
        await interaction.followUp({
          ephemeral: true,
          content: `<@${target}> was removed from the party.`,
        });
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
    currentVersion: number | null,
  ): Promise<void> {
    const buttons = [
      myTenManButton(guildId, interaction.user.id, this.options.componentSigningSecret),
    ];
    if (currentVersion !== null) {
      buttons.unshift(
        queueRefreshButton(guildId, currentVersion, this.options.componentSigningSecret),
      );
    }
    await interaction.reply({
      ephemeral: true,
      content: [
        '**This queue panel was updated**',
        'The queue changed after this button was created.',
      ].join('\n'),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)],
    });
    await this.queuePanelService.reconcile(guildId).catch(() => undefined);
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
        content: 'Match canceled. Cleanup status is available in `/10man hub`.',
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
          'Managed 10man channels were archived and locked. A Discord administrator may delete them manually if desired.',
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
      content: 'Managed setup recovery completed. You can run `/10man-config setup` again.',
      components: [],
    });
  }
}

function howItWorksText(): string {
  return [
    '**How 10mans work**',
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
        'Assign the Steam account you intend to use for 10man matches.',
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
