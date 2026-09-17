import type { Client } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

export interface RewardDiagnosticCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export class RewardDiagnosticsService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  public async run(guildId: string): Promise<RewardDiagnosticCheck[]> {
    const settings = await this.prisma.rewardSettings.findUnique({ where: { guildId } });
    if (settings === null)
      return [{ label: 'Rewards configuration', ok: false, detail: 'Not configured' }];
    const guild = await this.discord.guilds.fetch(guildId);
    const checks: RewardDiagnosticCheck[] = [
      {
        label: 'Rewards module',
        ok: settings.enabled,
        detail: settings.enabled ? 'Enabled' : 'Disabled',
      },
    ];
    for (const channelId of settings.textChannelIds) {
      const channel = await guild.channels.fetch(channelId);
      checks.push({
        label: `Text channel ${channelId}`,
        ok: channel?.isTextBased() === true,
        ...(channel?.isTextBased() === true ? {} : { detail: 'Missing or not text-based' }),
      });
    }
    for (const channelId of settings.voiceChannelIds) {
      const channel = await guild.channels.fetch(channelId);
      checks.push({
        label: `Voice channel ${channelId}`,
        ok: channel?.isVoiceBased() === true,
        ...(channel?.isVoiceBased() === true ? {} : { detail: 'Missing or not voice-based' }),
      });
    }
    const levels = await this.prisma.rewardLevel.findMany({
      where: { guildId, roleId: { not: null } },
      select: { roleId: true },
    });
    const roleIds = new Set([
      ...levels.flatMap((level) => (level.roleId === null ? [] : [level.roleId])),
      ...(settings.tagRewardRoleId === null ? [] : [settings.tagRewardRoleId]),
    ]);
    const botMember = await guild.members.fetchMe();
    for (const roleId of roleIds) {
      const role = await guild.roles.fetch(roleId);
      const ok = role !== null && !role.managed && role.position < botMember.roles.highest.position;
      checks.push({
        label: `Reward role ${roleId}`,
        ok,
        ...(ok ? {} : { detail: 'Missing, managed, or above the bot role' }),
      });
    }
    const [staleSessions, failedJobs, tagObservation] = await Promise.all([
      this.prisma.rewardVoiceSession.count({
        where: {
          guildId,
          status: 'ACTIVE',
          checkpointAt: { lt: new Date(Date.now() - settings.voiceIntervalSeconds * 3000) },
        },
      }),
      this.prisma.job.count({
        where: { type: { startsWith: 'REWARDS_' }, status: 'FAILED' },
      }),
      this.prisma.rewardMember.aggregate({
        where: { guildId, tagLastCheckedAt: { not: null } },
        _max: { tagLastCheckedAt: true },
      }),
    ]);
    checks.push({
      label: 'Voice session freshness',
      ok: staleSessions === 0,
      ...(staleSessions === 0 ? {} : { detail: `${String(staleSessions)} stale session(s)` }),
    });
    checks.push({
      label: 'Rewards worker jobs',
      ok: failedJobs === 0,
      ...(failedJobs === 0 ? {} : { detail: `${String(failedJobs)} failed job(s)` }),
    });
    if (settings.tagRewardRoleId !== null && tagObservation._max.tagLastCheckedAt !== null) {
      const staleAfter = settings.tagReconcileSeconds * 2000;
      const stale = Date.now() - tagObservation._max.tagLastCheckedAt.getTime() > staleAfter;
      checks.push({
        label: 'Guild-tag reconciliation freshness',
        ok: !stale,
        ...(stale ? { detail: 'Last successful observation is stale' } : {}),
      });
    }
    return checks;
  }
}
