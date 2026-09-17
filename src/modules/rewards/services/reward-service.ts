import type { PrismaClient } from '../../../generated/prisma/client.js';

export type RewardSource = 'TEXT_ACTIVITY' | 'VOICE_ACTIVITY' | 'ADMIN_ADJUSTMENT';

export interface AwardXpCommand {
  guildId: string;
  discordUserId: string;
  displayName: string;
  amount: number;
  source: RewardSource;
  idempotencyKey: string;
  actorDiscordUserId?: string;
  reason?: string;
  correlationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  awardedAt?: Date;
  textCooldownSeconds?: number;
}

export interface AwardXpResult {
  applied: boolean;
  effectiveXp: number;
  level: number;
}

export class RewardService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async award(command: AwardXpCommand): Promise<AwardXpResult> {
    this.validate(command);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reward-entry:${command.guildId}:${command.idempotencyKey}`}, 0))`;
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reward-member:${command.guildId}:${command.discordUserId}`}, 0))`;
      if (command.source === 'TEXT_ACTIVITY') {
        const receipt = await transaction.rewardActivityReceipt.findUnique({
          where: {
            guildId_idempotencyKey: {
              guildId: command.guildId,
              idempotencyKey: command.idempotencyKey,
            },
          },
        });
        if (receipt !== null) {
          const member = await transaction.rewardMember.findUniqueOrThrow({
            where: {
              guildId_discordUserId: {
                guildId: command.guildId,
                discordUserId: command.discordUserId,
              },
            },
            select: { effectiveXp: true, currentLevel: true },
          });
          return { applied: false, effectiveXp: member.effectiveXp, level: member.currentLevel };
        }
      }
      const existing = await transaction.rewardLedgerEntry.findUnique({
        where: {
          guildId_idempotencyKey: {
            guildId: command.guildId,
            idempotencyKey: command.idempotencyKey,
          },
        },
        select: { discordUserId: true },
      });
      if (existing !== null) {
        if (existing.discordUserId !== command.discordUserId) {
          throw new Error('Reward idempotency key belongs to another member');
        }
        const member = await transaction.rewardMember.findUniqueOrThrow({
          where: {
            guildId_discordUserId: {
              guildId: command.guildId,
              discordUserId: command.discordUserId,
            },
          },
          select: { effectiveXp: true, currentLevel: true },
        });
        return { applied: false, effectiveXp: member.effectiveXp, level: member.currentLevel };
      }

      const settings = await transaction.rewardSettings.findUnique({
        where: { guildId: command.guildId },
        select: { enabled: true },
      });
      if (settings?.enabled !== true) throw new Error('Member Rewards is disabled for this server');

      await transaction.user.upsert({
        where: { discordUserId: command.discordUserId },
        create: { discordUserId: command.discordUserId, displayName: command.displayName },
        update: { displayName: command.displayName },
      });
      const member = await transaction.rewardMember.upsert({
        where: {
          guildId_discordUserId: {
            guildId: command.guildId,
            discordUserId: command.discordUserId,
          },
        },
        create: { guildId: command.guildId, discordUserId: command.discordUserId },
        update: {},
        select: { effectiveXp: true, currentLevel: true, lastTextAwardAt: true },
      });
      const awardedAt = command.awardedAt ?? new Date();
      if (
        command.source === 'TEXT_ACTIVITY' &&
        member.lastTextAwardAt !== null &&
        awardedAt.getTime() - member.lastTextAwardAt.getTime() <
          (command.textCooldownSeconds ?? 0) * 1000
      ) {
        await transaction.rewardActivityReceipt.create({
          data: {
            guildId: command.guildId,
            discordUserId: command.discordUserId,
            idempotencyKey: command.idempotencyKey,
            source: command.source,
            accepted: false,
            createdAt: awardedAt,
          },
        });
        return { applied: false, effectiveXp: member.effectiveXp, level: member.currentLevel };
      }
      const effectiveXp = Math.max(0, member.effectiveXp + command.amount);
      const level = await transaction.rewardLevel.findFirst({
        where: { guildId: command.guildId, xpThreshold: { lte: effectiveXp } },
        orderBy: [{ xpThreshold: 'desc' }, { level: 'desc' }],
        select: { level: true },
      });
      if (command.source === 'TEXT_ACTIVITY') {
        await transaction.rewardActivityReceipt.create({
          data: {
            guildId: command.guildId,
            discordUserId: command.discordUserId,
            idempotencyKey: command.idempotencyKey,
            source: command.source,
            accepted: true,
            createdAt: awardedAt,
          },
        });
      }
      await transaction.rewardLedgerEntry.create({
        data: {
          guildId: command.guildId,
          discordUserId: command.discordUserId,
          amount: command.amount,
          source: command.source,
          idempotencyKey: command.idempotencyKey,
          ...(command.actorDiscordUserId === undefined
            ? {}
            : { actorDiscordUserId: command.actorDiscordUserId }),
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          metadata: command.metadata ?? {},
          createdAt: awardedAt,
        },
      });
      await transaction.rewardMember.update({
        where: {
          guildId_discordUserId: {
            guildId: command.guildId,
            discordUserId: command.discordUserId,
          },
        },
        data: {
          effectiveXp,
          currentLevel: level?.level ?? 0,
          ...(command.source === 'TEXT_ACTIVITY' ? { lastTextAwardAt: awardedAt } : {}),
        },
      });
      if (command.source === 'ADMIN_ADJUSTMENT') {
        await transaction.auditEvent.create({
          data: {
            guildId: command.guildId,
            actorDiscordUserId: command.actorDiscordUserId ?? null,
            eventType: 'reward_xp_adjusted',
            result: 'success',
            correlationId: command.correlationId ?? command.idempotencyKey,
            metadata: {
              discordUserId: command.discordUserId,
              amount: command.amount,
              reason: command.reason ?? '',
            },
          },
        });
        await transaction.job.upsert({
          where: { idempotencyKey: `rewards:roles:${command.guildId}` },
          update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
          create: {
            type: 'REWARDS_ROLE_RECONCILE',
            idempotencyKey: `rewards:roles:${command.guildId}`,
            payload: { guildId: command.guildId },
          },
        });
      }
      return { applied: true, effectiveXp, level: level?.level ?? 0 };
    });
  }

  private validate(command: AwardXpCommand): void {
    if (!Number.isSafeInteger(command.amount) || command.amount === 0) {
      throw new Error('Reward amount must be a non-zero safe integer');
    }
    if (command.idempotencyKey.length < 1 || command.idempotencyKey.length > 200) {
      throw new Error('Reward idempotency key must be between 1 and 200 characters');
    }
    if (
      command.source === 'TEXT_ACTIVITY' &&
      (!Number.isSafeInteger(command.textCooldownSeconds) ||
        (command.textCooldownSeconds ?? 0) <= 0)
    ) {
      throw new Error('Text reward cooldown must be a positive integer');
    }
    if (command.source === 'ADMIN_ADJUSTMENT') {
      if (command.actorDiscordUserId === undefined)
        throw new Error('Admin adjustment actor required');
      if (command.correlationId === undefined)
        throw new Error('Admin adjustment correlation required');
      if (command.reason?.trim() === '') throw new Error('Admin adjustment reason required');
      if (command.reason === undefined) throw new Error('Admin adjustment reason required');
    } else if (
      command.actorDiscordUserId !== undefined ||
      command.reason !== undefined ||
      command.correlationId !== undefined
    ) {
      throw new Error('Activity rewards cannot include admin adjustment fields');
    }
  }
}
