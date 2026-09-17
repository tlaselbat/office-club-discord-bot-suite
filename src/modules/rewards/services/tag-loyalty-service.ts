import type { Client, GuildMember, Role } from 'discord.js';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../../generated/prisma/client.js';

export class TagLoyaltyService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
    private readonly logger: Logger,
  ) {}

  public async observe(
    guildId: string,
    member: GuildMember,
    qualifying: boolean,
    observedAt = new Date(),
  ): Promise<void> {
    const settings = await this.prisma.rewardSettings.findUnique({
      where: { guildId },
      select: { enabled: true, tagRequiredSeconds: true, tagRewardRoleId: true },
    });
    if (settings?.enabled !== true || settings.tagRewardRoleId === null || member.user.bot) return;
    await this.prisma.user.upsert({
      where: { discordUserId: member.id },
      create: { discordUserId: member.id, displayName: member.displayName },
      update: { displayName: member.displayName },
    });
    const state = await this.prisma.rewardMember.upsert({
      where: { guildId_discordUserId: { guildId, discordUserId: member.id } },
      create: { guildId, discordUserId: member.id },
      update: {},
      select: { tagQualifiedSince: true, tagRoleGranted: true },
    });
    if (!qualifying) {
      if (state.tagRoleGranted) {
        await this.changeRole(guildId, member, settings.tagRewardRoleId, false);
      }
      await this.prisma.rewardMember.update({
        where: { guildId_discordUserId: { guildId, discordUserId: member.id } },
        data: { tagQualifiedSince: null, tagLastCheckedAt: observedAt, tagRoleGranted: false },
      });
      return;
    }
    const qualifiedSince = state.tagQualifiedSince ?? observedAt;
    const earned =
      observedAt.getTime() - qualifiedSince.getTime() >= settings.tagRequiredSeconds * 1000;
    if (earned && !state.tagRoleGranted) {
      await this.changeRole(guildId, member, settings.tagRewardRoleId, true);
    }
    await this.prisma.rewardMember.update({
      where: { guildId_discordUserId: { guildId, discordUserId: member.id } },
      data: {
        tagQualifiedSince: qualifiedSince,
        tagLastCheckedAt: observedAt,
        tagRoleGranted: state.tagRoleGranted || earned,
      },
    });
  }

  public async reconcileGuild(guildId: string, observedAt = new Date()): Promise<void> {
    const settings = await this.prisma.rewardSettings.findUnique({
      where: { guildId },
      select: { enabled: true, tagRewardRoleId: true },
    });
    if (settings?.enabled !== true || settings.tagRewardRoleId === null) return;
    const guild = await this.discord.guilds.fetch(guildId);
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      if (member.user.bot) continue;
      try {
        const user = await member.user.fetch(true);
        const qualifying =
          user.primaryGuild?.identityEnabled === true &&
          user.primaryGuild.identityGuildId === guildId;
        await this.observe(guildId, member, qualifying, observedAt);
      } catch (error: unknown) {
        this.logger.warn(
          { err: error, guildId, userId: member.id },
          'Guild-tag observation unavailable',
        );
      }
    }
  }

  public async reconcileEnabledGuilds(now = new Date()): Promise<number> {
    const settings = await this.prisma.rewardSettings.findMany({
      where: { enabled: true, tagRewardRoleId: { not: null } },
      select: { guildId: true, tagReconcileSeconds: true },
    });
    for (const setting of settings) await this.reconcileGuild(setting.guildId, now);
    return (
      (settings.length === 0
        ? 900
        : Math.min(...settings.map((setting) => setting.tagReconcileSeconds))) * 1000
    );
  }

  private async changeRole(
    guildId: string,
    member: GuildMember,
    roleId: string,
    grant: boolean,
  ): Promise<void> {
    const guild = await this.discord.guilds.fetch(guildId);
    const [role, botMember] = await Promise.all([
      guild.roles.fetch(roleId),
      guild.members.fetchMe(),
    ]);
    this.assertAssignable(role, botMember);
    if (grant) await member.roles.add(roleId, 'Member Rewards guild-tag loyalty');
    else await member.roles.remove(roleId, 'Member Rewards guild-tag loyalty');
  }

  private assertAssignable(role: Role | null, botMember: GuildMember): void {
    if (role === null) throw new Error('Configured guild-tag reward role no longer exists');
    if (role.managed) throw new Error('Configured guild-tag reward role is managed');
    if (role.position >= botMember.roles.highest.position) {
      throw new Error('Configured guild-tag reward role is not below the bot role');
    }
  }
}
