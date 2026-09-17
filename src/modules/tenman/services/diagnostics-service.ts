import { ChannelType, PermissionFlagsBits, type Client, type GuildBasedChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostClient } from '../integrations/dathost/client.js';

export interface DiagnosticsReport {
  configured: boolean;
  enabled: boolean;
  channels: { label: string; id: string; ok: boolean; error?: string }[];
  roles: { label: string; id: string; ok: boolean; error?: string }[];
  permissions: { label: string; ok: boolean; missing?: string[] }[];
  template?: { id: string; ok: boolean; error?: string };
  activeMatch?: { id: string; state: string; cleanupStatus: string } | null;
  managed?: {
    state: string;
    setupStep: string | null;
    categoryId: string | null;
    channelIds: string[];
    manageChannels: boolean;
    createdAt: Date | null;
  };
}

export class DiagnosticsService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly dathost: DatHostClient,
  ) {}

  public async runGuildDiagnostics(guildId: string): Promise<DiagnosticsReport> {
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (settings === null) {
      return {
        configured: false,
        enabled: false,
        channels: [],
        roles: [],
        permissions: [],
      };
    }

    const guild = await this.client.guilds.fetch(guildId);
    const botMember = guild.members.me ?? (await guild.members.fetch(this.client.user?.id ?? ''));

    const channelChecks: DiagnosticsReport['channels'] = [];
    const channelEntries = [
      { label: 'lobby text', id: settings.lobbyTextChannelId, type: ChannelType.GuildText },
      { label: 'lobby voice', id: settings.lobbyVoiceChannelId, type: ChannelType.GuildVoice },
      { label: 'team 1 voice', id: settings.team1VoiceChannelId, type: ChannelType.GuildVoice },
      { label: 'team 2 voice', id: settings.team2VoiceChannelId, type: ChannelType.GuildVoice },
    ] as const;
    for (const entry of channelEntries) {
      const channel =
        entry.id === null ? null : await guild.channels.fetch(entry.id).catch(() => null);
      if (channel === null) {
        channelChecks.push({
          label: entry.label,
          id: entry.id ?? 'unset',
          ok: false,
          error: 'not found',
        });
        continue;
      }
      if (channel.type !== entry.type) {
        channelChecks.push({
          label: entry.label,
          id: entry.id ?? 'unset',
          ok: false,
          error: `expected ${ChannelType[entry.type]}`,
        });
        continue;
      }
      channelChecks.push({ label: entry.label, id: entry.id ?? 'unset', ok: true });
    }

    const permissionChecks: DiagnosticsReport['permissions'] = [];
    const textChannel =
      settings.lobbyTextChannelId === null
        ? null
        : await guild.channels.fetch(settings.lobbyTextChannelId).catch(() => null);
    if (textChannel !== null) {
      const missing = this.missingPermissions(botMember, textChannel, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ]);
      permissionChecks.push({
        label: 'lobby text channel',
        ok: missing.length === 0,
        ...(missing.length === 0 ? {} : { missing }),
      });
    }
    for (const voiceId of [
      settings.lobbyVoiceChannelId,
      settings.team1VoiceChannelId,
      settings.team2VoiceChannelId,
    ]) {
      if (voiceId === null) continue;
      const voiceChannel = await guild.channels.fetch(voiceId).catch(() => null);
      if (voiceChannel === null) continue;
      const missing = this.missingPermissions(botMember, voiceChannel, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.MoveMembers,
      ]);
      permissionChecks.push({
        label: `${voiceChannel.name} voice channel`,
        ok: missing.length === 0,
        ...(missing.length === 0 ? {} : { missing }),
      });
    }

    const roleChecks: DiagnosticsReport['roles'] = [];
    const roleEntries = [
      { label: 'privileged', ids: settings.privilegedRoleIds },
      { label: 'moderator', ids: settings.moderatorRoleIds },
      { label: 'administrator', ids: settings.administratorRoleIds },
    ] as const;
    for (const entry of roleEntries) {
      for (const roleId of entry.ids) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        roleChecks.push({
          label: `${entry.label} role`,
          id: roleId,
          ok: role !== null,
          ...(role === null ? { error: 'not found' } : {}),
        });
      }
    }

    let template: DiagnosticsReport['template'] | undefined;
    if (settings.dathostTemplateServerId !== null) {
      const reachable = await this.dathost
        .getServer(settings.dathostTemplateServerId)
        .then(() => true)
        .catch(() => false);
      template = {
        id: settings.dathostTemplateServerId,
        ok: reachable,
        ...(reachable ? {} : { error: 'unreachable or not found' }),
      };
    }

    const activeMatch = await this.prisma.match.findFirst({
      where: { guildId, guildSlotActive: true },
      select: { id: true, state: true, cleanupStatus: true },
    });

    return {
      configured: true,
      enabled: settings.enabled,
      channels: channelChecks,
      roles: roleChecks,
      permissions: permissionChecks,
      ...(template === undefined ? {} : { template }),
      activeMatch: activeMatch === null ? null : activeMatch,
      managed: {
        state: settings.managedResourceState,
        setupStep: settings.managedSetupStep,
        categoryId: settings.managedCategoryId,
        channelIds: settings.managedChannelIds,
        manageChannels: botMember.permissions.has(PermissionFlagsBits.ManageChannels),
        createdAt: settings.managedResourcesCreatedAt,
      },
    };
  }

  private missingPermissions(
    botMember: {
      permissionsIn: (channel: GuildBasedChannel) => { has: (permission: bigint) => boolean };
    },
    channel: GuildBasedChannel,
    required: readonly bigint[],
  ): string[] {
    const permissions = botMember.permissionsIn(channel);
    return required
      .filter((permission) => !permissions.has(permission))
      .map((permission) => String(permission));
  }
}
