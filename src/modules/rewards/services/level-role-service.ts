import type { Client, GuildMember, Role } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

export class LevelRoleService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  public async reconcileGuild(guildId: string): Promise<void> {
    const members = await this.prisma.rewardMember.findMany({
      where: { guildId },
      select: { discordUserId: true },
    });
    for (const member of members) await this.reconcile(guildId, member.discordUserId);
  }

  public async reconcile(guildId: string, discordUserId: string): Promise<void> {
    const memberState = await this.prisma.rewardMember.findUnique({
      where: { guildId_discordUserId: { guildId, discordUserId } },
      select: { effectiveXp: true },
    });
    if (memberState === null) return;
    const levels = await this.prisma.rewardLevel.findMany({
      where: { guildId, roleId: { not: null } },
      orderBy: { xpThreshold: 'asc' },
      select: { xpThreshold: true, roleId: true },
    });
    const guild = await this.discord.guilds.fetch(guildId);
    const [member, botMember] = await Promise.all([
      guild.members.fetch(discordUserId),
      guild.members.fetchMe(),
    ]);
    const configured = new Set(
      levels.flatMap((level) => (level.roleId === null ? [] : [level.roleId])),
    );
    const desired = new Set(
      levels.flatMap((level) =>
        level.roleId !== null && level.xpThreshold <= memberState.effectiveXp ? [level.roleId] : [],
      ),
    );
    const roles = await guild.roles.fetch();
    for (const roleId of configured) this.assertAssignable(roles.get(roleId), botMember);
    const add = [...desired].filter((roleId) => !member.roles.cache.has(roleId));
    const remove = [...configured].filter(
      (roleId) => !desired.has(roleId) && member.roles.cache.has(roleId),
    );
    if (add.length > 0) await member.roles.add(add, 'Member Rewards level reconciliation');
    if (remove.length > 0) await member.roles.remove(remove, 'Member Rewards level reconciliation');
  }

  private assertAssignable(role: Role | undefined, botMember: GuildMember): void {
    if (role === undefined) throw new Error('Configured reward role no longer exists');
    if (role.managed) throw new Error(`Reward role ${role.id} is managed by another integration`);
    if (role.position >= botMember.roles.highest.position) {
      throw new Error(`Reward role ${role.id} is not below the bot role`);
    }
  }
}
