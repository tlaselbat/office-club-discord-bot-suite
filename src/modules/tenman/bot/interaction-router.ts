import type { MessageComponentInteraction } from 'discord.js';
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
import { adminGeneration, parseAdminCustomId } from './admin-custom-id.js';
import { parseMatchCustomId } from './match-custom-id.js';
import { parseQueueCustomId } from './queue-custom-id.js';
import { parseMatchAdminCustomId } from './match-admin-custom-id.js';
import { parsePlayerAdminCustomId } from './player-admin-custom-id.js';
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
  guildResourceService: GuildResourceService;
  adminActorFor: (interaction: MessageComponentInteraction) => Promise<ActorContext>;
  matchService: MatchService;
  participantInfo: MatchParticipantInfoService;
}

/** Owns every supported 10man component namespace. */
export class TenManComponentInteractionRouter {
  private readonly match: MatchInteractionRouter;
  private readonly queueService: QueueService;
  private readonly matchHistory: MatchHistoryService;
  private readonly matchAdmin: MatchAdminService;

  public constructor(private readonly options: TenManComponentInteractionRouterOptions) {
    this.match = new MatchInteractionRouter(options);
    this.queueService = new QueueService(options.prisma);
    this.matchHistory = new MatchHistoryService(options.prisma);
    this.matchAdmin = new MatchAdminService(options.prisma);
  }

  public async handle(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.customId.startsWith('tps2:')) return this.handlePlayerAdmin(interaction);
    if (interaction.customId.startsWith('tma2:')) return this.handleMatchAdmin(interaction);
    if (interaction.customId.startsWith('tmm:')) return this.match.handle(interaction);
    if (interaction.customId.startsWith('tmq:')) return this.handleQueue(interaction);
    if (interaction.customId.startsWith('tma:')) return this.handleAdmin(interaction);
    throw new Error('Unsupported 10man component namespace');
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

  private async handleQueue(interaction: MessageComponentInteraction): Promise<void> {
    if (interaction.guildId === null) throw new Error('Guild interaction required');
    const payload = parseQueueCustomId(interaction.customId, this.options.componentSigningSecret);
    if (payload.guildId !== interaction.guildId)
      throw new Error('Queue does not belong to this guild');
    await interaction.deferReply({ ephemeral: true });
    const queue = await this.options.prisma.tenManQueue.findUnique({
      where: { guildId: payload.guildId },
    });
    if (queue === null || queue.version !== payload.version)
      throw new Error('Queue panel is stale');
    if (payload.action === 'JOIN') {
      const result = await this.queueService.join({
        guildId: payload.guildId,
        discordUserId: interaction.user.id,
        displayName: interaction.user.globalName ?? interaction.user.username,
        correlationId: interaction.id,
      });
      await interaction.editReply({
        content:
          result.promotedMatchId === undefined
            ? 'Joined the queue.'
            : 'Queue is full; ready check has started.',
      });
      return;
    }
    await this.queueService.leave(payload.guildId, interaction.user.id, interaction.id);
    await interaction.editReply({ content: 'Left the queue.' });
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
