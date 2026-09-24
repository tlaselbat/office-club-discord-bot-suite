import type { Client, MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';
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
import { parseQueueCustomId } from './queue-custom-id.js';
import { parseMatchAdminCustomId } from './match-admin-custom-id.js';
import { parsePlayerAdminCustomId } from './player-admin-custom-id.js';
import { parsePlayerHubCustomId, createPlayerHubCustomId } from './player-hub-custom-id.js';
import {
  parseSteamAccountCustomId,
  createSteamAccountCustomId,
} from './steam-account-custom-id.js';
import {
  parseResultDisputeCustomId,
  createResultDisputeCustomId,
  expandMatchUuid,
} from './match-result-dispute-custom-id.js';
import { buildPlayerHubResponse } from './player-hub-components.js';
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
  adminActorFor: (interaction: MessageComponentInteraction) => Promise<ActorContext>;
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
  }

  public async handle(interaction: ComponentOrModal): Promise<void> {
    if (interaction.isModalSubmit()) return this.handleModal(interaction);
    if (!interaction.isMessageComponent()) throw new Error('Unsupported interaction type');

    if (interaction.customId.startsWith('tps2:')) return this.handlePlayerAdmin(interaction);
    if (interaction.customId.startsWith('tma2:')) return this.handleMatchAdmin(interaction);
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
      if (payload.action !== 'MODAL') throw new Error('Unsupported modal namespace');
      const reason = interaction.fields.getTextInputValue('dispute_reason');
      const result = await this.resultDisputeService.createDispute(
        expandMatchUuid(payload.matchId),
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
    throw new Error('Unsupported result-dispute control');
  }

  private async handlePlayerHub(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    await interaction.deferReply({ ephemeral: true });
    const payload = parsePlayerHubCustomId(
      interaction.customId,
      this.options.componentSigningSecret,
    );
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

    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId: payload.guildId },
    });
    if (queue === null || queue.version !== payload.version) {
      await this.renderStaleRefresh(interaction, payload.guildId);
      return;
    }

    if (payload.action === 'REFRESH') {
      await interaction.deferReply({ ephemeral: true });
      await this.queuePanelService.reconcile(payload.guildId);
      await interaction.editReply({ content: 'Queue panel refreshed.' });
      return;
    }

    if (payload.action === 'HOW_IT_WORKS') {
      await interaction.reply({ ephemeral: true, content: howItWorksText() });
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

    await this.queueService.leave(payload.guildId, interaction.user.id, interaction.id);
    await interaction.editReply({ content: 'You left the queue.' });
  }

  private async renderQueueJoinResponse(
    interaction: MessageComponentInteraction,
    guildId: string,
    result: Awaited<ReturnType<QueueService['join']>>,
  ): Promise<void> {
    switch (result.status) {
      case 'joined':
        await interaction.editReply({
          content:
            result.promotedMatchId === undefined
              ? `Joined the queue. **${String(result.playersInQueue)} / ${String(result.queueSize)}** players.`
              : 'Queue is full; ready check has started.',
        });
        return;
      case 'already_queued':
        await interaction.editReply({
          content: `You are already in the queue. **${String(result.playersInQueue)} / ${String(result.queueSize)}** players.`,
        });
        return;
      case 'missing_steam':
        await interaction.editReply({
          content:
            'You need an assigned Steam account before joining. Use the Steam Account button.',
          components: buildSteamAccountButton(
            guildId,
            interaction.user.id,
            this.options.componentSigningSecret,
          ),
        });
        return;
      case 'queue_banned':
        await interaction.editReply({
          content:
            result.expiresAt === null
              ? `You are banned from the queue: ${result.reason}`
              : `You are banned from the queue until <t:${String(Math.floor(result.expiresAt.getTime() / 1000))}:f>: ${result.reason}`,
        });
        return;
      case 'queue_unavailable':
        await interaction.editReply({ content: 'The queue is not available right now.' });
        return;
      case 'queue_full':
        await interaction.editReply({ content: 'The queue is full. Try again when it reopens.' });
        return;
      case 'active_match':
        await interaction.editReply({ content: 'A match is already being formed or played.' });
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

  private async renderStaleRefresh(
    interaction: MessageComponentInteraction,
    guildId: string,
  ): Promise<void> {
    const refreshId = createPlayerHubCustomId(
      { action: 'HUB', guildId, actorDiscordUserId: interaction.user.id },
      this.options.componentSigningSecret,
    );
    await interaction.reply({
      ephemeral: true,
      content: 'This control is out of date. Refresh to see the current state.',
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              custom_id: refreshId,
              label: 'Refresh My 10man',
            },
          ],
        },
      ],
    });
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
        content: 'Match canceled. Cleanup status is available in `/10man status`.',
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
      content: 'Managed setup recovery completed. You can run `/match admin setup` again.',
      components: [],
    });
  }
}

function howItWorksText(): string {
  return [
    '**How 10man works**',
    '',
    '1. Press **Steam Account** and paste your Steam ID64/profile URL.',
    '2. Press **Join Queue** when the queue is open.',
    '3. When 10 players are queued, you get a ready check with a deadline.',
    '4. After ready check, captains are picked and the map is vetoed.',
    '5. The bot provisions a private CS2 server and moves you to team voice channels.',
    '6. Play the match; the bot records the result automatically.',
    '7. Queue again or report an issue if something went wrong.',
  ].join('\n');
}

export function buildSteamAccountStatusResponse(
  active: { steamId64: string; assignedAt: Date } | null,
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): { content: string; components: ReturnType<typeof buildSteamAccountButton> } {
  if (active === null) {
    return {
      content: [
        'You do not have an assigned Steam account.',
        'Assign the Steam account you intend to use for 10man matches.',
      ].join('\n'),
      components: buildSteamAccountButton(guildId, actorDiscordUserId, secret),
    };
  }
  return {
    content: [
      'Assigned Steam account:',
      `**SteamID64:** \`${active.steamId64}\``,
      `Assigned <t:${String(Math.floor(active.assignedAt.getTime() / 1000))}:R>.`,
      '',
      'This association is used for roster building only. It does not verify Steam ownership.',
    ].join('\n'),
    components: buildSteamAccountButton(guildId, actorDiscordUserId, secret),
  };
}
