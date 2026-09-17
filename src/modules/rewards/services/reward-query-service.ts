import type { PrismaClient } from '../../../generated/prisma/client.js';

export class RewardQueryService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async profile(guildId: string, discordUserId: string) {
    await this.assertEnabled(guildId);
    const member = await this.prisma.rewardMember.findUnique({
      where: { guildId_discordUserId: { guildId, discordUserId } },
      include: { user: { select: { displayName: true } } },
    });
    if (member === null) return null;
    const [higher, nextLevel] = await Promise.all([
      this.prisma.rewardMember.count({
        where: { guildId, effectiveXp: { gt: member.effectiveXp } },
      }),
      this.prisma.rewardLevel.findFirst({
        where: { guildId, xpThreshold: { gt: member.effectiveXp } },
        orderBy: { xpThreshold: 'asc' },
        select: { level: true, xpThreshold: true },
      }),
    ]);
    return {
      displayName: member.user.displayName,
      effectiveXp: member.effectiveXp,
      level: member.currentLevel,
      rank: higher + 1,
      nextLevel,
      tagQualifiedSince: member.tagQualifiedSince,
      tagLastCheckedAt: member.tagLastCheckedAt,
      tagRoleGranted: member.tagRoleGranted,
    };
  }

  public async leaderboard(guildId: string, page = 1, pageSize = 10) {
    await this.assertEnabled(guildId);
    const take = Math.min(Math.max(pageSize, 1), 25);
    const normalizedPage = Math.max(page, 1);
    const [members, total] = await Promise.all([
      this.prisma.rewardMember.findMany({
        where: { guildId },
        orderBy: [{ effectiveXp: 'desc' }, { updatedAt: 'asc' }, { discordUserId: 'asc' }],
        skip: (normalizedPage - 1) * take,
        take,
        select: {
          discordUserId: true,
          effectiveXp: true,
          currentLevel: true,
          user: { select: { displayName: true } },
        },
      }),
      this.prisma.rewardMember.count({ where: { guildId } }),
    ]);
    return { members, total, page: normalizedPage, pageSize: take };
  }

  public async tagSettings(guildId: string) {
    await this.assertEnabled(guildId);
    return this.prisma.rewardSettings.findUniqueOrThrow({
      where: { guildId },
      select: { tagRequiredSeconds: true, tagRewardRoleId: true },
    });
  }

  private async assertEnabled(guildId: string): Promise<void> {
    const settings = await this.prisma.rewardSettings.findUnique({
      where: { guildId },
      select: { enabled: true },
    });
    if (settings?.enabled !== true) throw new Error('Member Rewards is disabled for this server');
  }
}
