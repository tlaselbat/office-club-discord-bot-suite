import { ChannelType, type Client } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { RewardService } from './reward-service.js';
import { LevelRoleService } from './level-role-service.js';
import { VoiceActivityService } from './voice-activity-service.js';
import { scheduleJob } from '../../../database/schedule-job.js';

export interface RewardLevelInput {
  level: number;
  xpThreshold: number;
  label?: string;
  roleId?: string;
}

export interface UpdateRewardSettingsCommand {
  guildId: string;
  actorDiscordUserId: string;
  correlationId: string;
  expectedVersion: number | null;
  textXpAmount: number;
  textCooldownSeconds: number;
  voiceXpAmount: number;
  voiceIntervalSeconds: number;
  textChannelIds: string[];
  voiceChannelIds: string[];
  tagRequiredSeconds: number;
  tagRewardRoleId?: string;
  tagReconcileSeconds: number;
  levels: RewardLevelInput[];
}

export class RewardSettingsService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  public async update(command: UpdateRewardSettingsCommand): Promise<void> {
    this.validateValues(command);
    const guild = await this.discord.guilds.fetch(command.guildId);
    for (const channelId of command.textChannelIds) {
      const channel = await guild.channels.fetch(channelId);
      if (channel?.type !== ChannelType.GuildText)
        throw new Error(`Text channel ${channelId} is invalid`);
    }
    for (const channelId of command.voiceChannelIds) {
      const channel = await guild.channels.fetch(channelId);
      if (channel?.type !== ChannelType.GuildVoice)
        throw new Error(`Voice channel ${channelId} is invalid`);
    }
    const roleIds = [
      ...command.levels.flatMap((level) => (level.roleId === undefined ? [] : [level.roleId])),
      ...(command.tagRewardRoleId === undefined ? [] : [command.tagRewardRoleId]),
    ];
    const botMember = await guild.members.fetchMe();
    for (const roleId of new Set(roleIds)) {
      const role = await guild.roles.fetch(roleId);
      if (role === null || role.managed || role.position >= botMember.roles.highest.position) {
        throw new Error(`Reward role ${roleId} is not assignable by the bot`);
      }
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reward-settings:${command.guildId}`}, 0))`;
      const current = await transaction.rewardSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if ((current?.version ?? null) !== command.expectedVersion) {
        throw new Error('Reward configuration changed; reload and try again');
      }
      await transaction.rewardSettings.upsert({
        where: { guildId: command.guildId },
        create: {
          guildId: command.guildId,
          textXpAmount: command.textXpAmount,
          textCooldownSeconds: command.textCooldownSeconds,
          voiceXpAmount: command.voiceXpAmount,
          voiceIntervalSeconds: command.voiceIntervalSeconds,
          textChannelIds: command.textChannelIds,
          voiceChannelIds: command.voiceChannelIds,
          tagRequiredSeconds: command.tagRequiredSeconds,
          ...(command.tagRewardRoleId === undefined
            ? {}
            : { tagRewardRoleId: command.tagRewardRoleId }),
          tagReconcileSeconds: command.tagReconcileSeconds,
        },
        update: {
          textXpAmount: command.textXpAmount,
          textCooldownSeconds: command.textCooldownSeconds,
          voiceXpAmount: command.voiceXpAmount,
          voiceIntervalSeconds: command.voiceIntervalSeconds,
          textChannelIds: command.textChannelIds,
          voiceChannelIds: command.voiceChannelIds,
          tagRequiredSeconds: command.tagRequiredSeconds,
          tagRewardRoleId: command.tagRewardRoleId ?? null,
          tagReconcileSeconds: command.tagReconcileSeconds,
          version: { increment: 1 },
        },
      });
      await transaction.rewardLevel.deleteMany({ where: { guildId: command.guildId } });
      if (command.levels.length > 0) {
        await transaction.rewardLevel.createMany({
          data: command.levels.map((level) => ({
            guildId: command.guildId,
            level: level.level,
            xpThreshold: level.xpThreshold,
            ...(level.label === undefined ? {} : { label: level.label }),
            ...(level.roleId === undefined ? {} : { roleId: level.roleId }),
          })),
        });
      }
      await transaction.$executeRaw`
        UPDATE reward_members AS member
        SET current_level = COALESCE((
          SELECT level FROM reward_levels
          WHERE guild_id = ${command.guildId} AND xp_threshold <= member.effective_xp
          ORDER BY xp_threshold DESC, level DESC
          LIMIT 1
        ), 0), updated_at = NOW()
        WHERE member.guild_id = ${command.guildId}
      `;
      for (const recurring of [
        { idempotencyKey: 'rewards:voice-accrual', type: 'REWARDS_VOICE_ACCRUAL' },
        { idempotencyKey: 'rewards:tag-reconcile', type: 'REWARDS_TAG_RECONCILE' },
      ]) {
        await scheduleJob(transaction, {
          type: recurring.type,
          idempotencyKey: recurring.idempotencyKey,
          payload: {},
        });
      }
      await scheduleJob(transaction, {
        type: 'REWARDS_ROLE_RECONCILE',
        idempotencyKey: `rewards:roles:${command.guildId}`,
        payload: { guildId: command.guildId },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'reward_settings_updated',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { levelCount: command.levels.length },
        },
      });
    });
    await this.reconcileCurrentVoice(command.guildId);
  }

  public async setEnabled(
    guildId: string,
    enabled: boolean,
    actorDiscordUserId: string,
    correlationId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reward-settings:${guildId}`}, 0))`;
      const current = await transaction.rewardSettings.findUnique({ where: { guildId } });
      if (current === null || current.version !== expectedVersion) {
        throw new Error('Reward configuration changed; reload and try again');
      }
      await transaction.rewardSettings.update({
        where: { guildId },
        data: { enabled, version: { increment: 1 } },
      });
      if (!enabled) {
        await transaction.rewardVoiceSession.updateMany({
          where: { guildId, status: 'ACTIVE' },
          data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } },
        });
      }
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: enabled ? 'rewards_enabled' : 'rewards_disabled',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
    if (enabled) await this.reconcileCurrentVoice(guildId);
  }

  private async reconcileCurrentVoice(guildId: string): Promise<void> {
    const guild = await this.discord.guilds.fetch(guildId);
    const connected = [...guild.voiceStates.cache.values()].flatMap((state) => {
      const member = state.member;
      return member === null || member.user.bot || state.channelId === null
        ? []
        : [
            {
              discordUserId: member.id,
              displayName: member.displayName,
              channelId: state.channelId,
            },
          ];
    });
    await new VoiceActivityService(
      this.prisma,
      new RewardService(this.prisma),
      new LevelRoleService(this.prisma, this.discord),
    ).reconcileGuild(guildId, connected);
  }

  private validateValues(command: UpdateRewardSettingsCommand): void {
    const positive = [
      command.textXpAmount,
      command.textCooldownSeconds,
      command.voiceXpAmount,
      command.voiceIntervalSeconds,
      command.tagRequiredSeconds,
      command.tagReconcileSeconds,
    ];
    if (positive.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error('Reward values must be positive integers');
    }
    const sorted = [...command.levels].sort((a, b) => a.level - b.level);
    if (
      sorted.some(
        (level, index) =>
          level.level < 0 ||
          level.xpThreshold < 0 ||
          (index > 0 && level.xpThreshold <= (sorted[index - 1]?.xpThreshold ?? -1)),
      )
    ) {
      throw new Error('Reward level thresholds must be nonnegative and strictly increasing');
    }
    if (new Set(sorted.map((level) => level.level)).size !== sorted.length) {
      throw new Error('Reward levels must be unique');
    }
  }
}
