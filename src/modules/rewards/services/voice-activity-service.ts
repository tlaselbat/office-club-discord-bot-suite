import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { LevelRoleService } from './level-role-service.js';
import type { RewardService } from './reward-service.js';

export interface VoiceObservation {
  guildId: string;
  discordUserId: string;
  displayName: string;
  channelId: string | null;
  observedAt: Date;
}

export class VoiceActivityService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly rewards: RewardService,
    private readonly levelRoles: LevelRoleService,
  ) {}

  public async observe(observation: VoiceObservation): Promise<void> {
    await this.accrue(observation.observedAt, {
      guildId: observation.guildId,
      discordUserId: observation.discordUserId,
    });
    const settings = await this.prisma.rewardSettings.findUnique({
      where: { guildId: observation.guildId },
      select: { enabled: true, voiceChannelIds: true },
    });
    const eligibleChannel =
      settings?.enabled === true &&
      observation.channelId !== null &&
      settings.voiceChannelIds.includes(observation.channelId)
        ? observation.channelId
        : null;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reward-voice:${observation.guildId}:${observation.discordUserId}`}, 0))`;
      const active = await transaction.rewardVoiceSession.findFirst({
        where: {
          guildId: observation.guildId,
          discordUserId: observation.discordUserId,
          status: 'ACTIVE',
        },
      });
      if (active?.channelId === eligibleChannel) return;
      if (active !== null) {
        await transaction.rewardVoiceSession.update({
          where: { id: active.id },
          data: { status: 'CLOSED', closedAt: observation.observedAt, version: { increment: 1 } },
        });
      }
      if (eligibleChannel === null) return;
      await transaction.user.upsert({
        where: { discordUserId: observation.discordUserId },
        create: {
          discordUserId: observation.discordUserId,
          displayName: observation.displayName,
        },
        update: { displayName: observation.displayName },
      });
      await transaction.rewardMember.upsert({
        where: {
          guildId_discordUserId: {
            guildId: observation.guildId,
            discordUserId: observation.discordUserId,
          },
        },
        create: { guildId: observation.guildId, discordUserId: observation.discordUserId },
        update: {},
      });
      await transaction.rewardVoiceSession.create({
        data: {
          guildId: observation.guildId,
          discordUserId: observation.discordUserId,
          channelId: eligibleChannel,
          connectedAt: observation.observedAt,
          checkpointAt: observation.observedAt,
        },
      });
    });
  }

  public async reconcileGuild(
    guildId: string,
    connected: Array<{ discordUserId: string; displayName: string; channelId: string }>,
    observedAt = new Date(),
  ): Promise<void> {
    const active = await this.prisma.rewardVoiceSession.findMany({
      where: { guildId, status: 'ACTIVE' },
      select: { discordUserId: true },
    });
    const connectedIds = new Set(connected.map((member) => member.discordUserId));
    for (const member of connected) {
      await this.observe({ guildId, ...member, observedAt });
    }
    for (const session of active) {
      if (connectedIds.has(session.discordUserId)) continue;
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { discordUserId: session.discordUserId },
        select: { displayName: true },
      });
      await this.observe({
        guildId,
        discordUserId: session.discordUserId,
        displayName: user.displayName,
        channelId: null,
        observedAt,
      });
    }
  }

  public async accrue(
    now = new Date(),
    member?: { guildId: string; discordUserId: string },
  ): Promise<number> {
    const sessions = await this.prisma.rewardVoiceSession.findMany({
      where: {
        status: 'ACTIVE',
        checkpointAt: { lt: now },
        ...(member === undefined ? {} : member),
      },
      orderBy: { checkpointAt: 'asc' },
    });
    let awards = 0;
    for (const session of sessions) {
      const settings = await this.prisma.rewardSettings.findUnique({
        where: { guildId: session.guildId },
        select: {
          enabled: true,
          voiceXpAmount: true,
          voiceIntervalSeconds: true,
          voiceChannelIds: true,
        },
      });
      if (settings?.enabled !== true || !settings.voiceChannelIds.includes(session.channelId)) {
        await this.prisma.rewardVoiceSession.updateMany({
          where: { id: session.id, status: 'ACTIVE', version: session.version },
          data: { status: 'CLOSED', closedAt: now, version: { increment: 1 } },
        });
        continue;
      }
      const intervalMs = settings.voiceIntervalSeconds * 1000;
      const intervals = Math.floor((now.getTime() - session.checkpointAt.getTime()) / intervalMs);
      if (intervals < 1) continue;
      const checkpointAt = new Date(session.checkpointAt.getTime() + intervals * intervalMs);
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { discordUserId: session.discordUserId },
        select: { displayName: true },
      });
      const result = await this.rewards.award({
        guildId: session.guildId,
        discordUserId: session.discordUserId,
        displayName: user.displayName,
        amount: intervals * settings.voiceXpAmount,
        source: 'VOICE_ACTIVITY',
        idempotencyKey: `voice:${session.id}:${checkpointAt.toISOString()}`,
        metadata: { channelId: session.channelId, intervals },
        awardedAt: checkpointAt,
      });
      const updated = await this.prisma.rewardVoiceSession.updateMany({
        where: { id: session.id, status: 'ACTIVE', version: session.version },
        data: { checkpointAt, version: { increment: 1 } },
      });
      if (updated.count === 0) continue;
      if (result.applied) {
        awards += 1;
        await this.levelRoles.reconcile(session.guildId, session.discordUserId);
      }
    }
    return awards;
  }
}
