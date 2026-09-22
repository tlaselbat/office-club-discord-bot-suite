import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type GuildBasedChannel,
  type Role,
} from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { assertCompetitiveBo1FiveVFive, gameProfileSchema } from '../domain/game-profile.js';

export interface UpdateGuildSettingsCommand {
  guildId: string;
  actorDiscordUserId: string;
  correlationId: string;
  lobbyTextChannelId: string;
  lobbyVoiceChannelId: string;
  team1VoiceChannelId: string;
  team2VoiceChannelId: string;
  resultsChannelId?: string;
  privilegedRoleIds: string[];
  moderatorRoleIds: string[];
  administratorRoleIds: string[];
  dathostTemplateServerId: string;
  defaultServerLocation?: string;
  defaultGameProfileKey?: string;
  enabled?: boolean;
  queueSize?: number;
  partyEnabled?: boolean;
  readyTimeoutSeconds?: number;
  teamSelectionMode?: 'CAPTAINS' | 'RANDOM';
  mapSelectionMode?: 'CAPTAIN_VETO' | 'RANDOM';
  expectedVersion?: number | null;
}

interface ChannelPermissionCheck {
  channel: GuildBasedChannel;
  required: bigint[];
  label: string;
}

export class GuildSettingsService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
  ) {}

  public async update(command: UpdateGuildSettingsCommand): Promise<void> {
    if (command.queueSize !== undefined && (command.queueSize < 2 || command.queueSize > 100))
      throw new Error('Queue size must be between 2 and 100');
    if (
      command.readyTimeoutSeconds !== undefined &&
      (command.readyTimeoutSeconds < 15 || command.readyTimeoutSeconds > 900)
    )
      throw new Error('Ready timeout must be between 15 and 900 seconds');
    const existing = await this.prisma.tenManSettings.findUnique({
      where: { guildId: command.guildId },
    });
    if (existing !== null && existing.managedResourceState !== 'NONE') {
      throw new Error(
        'Managed channels must be torn down or recovered before manual configuration',
      );
    }
    const guild = await this.client.guilds.fetch(command.guildId);
    const botMember = guild.members.me ?? (await guild.members.fetch(this.client.user?.id ?? ''));

    const lobbyTextChannel = await guild.channels.fetch(command.lobbyTextChannelId);
    const lobbyVoiceChannel = await guild.channels.fetch(command.lobbyVoiceChannelId);
    const team1VoiceChannel = await guild.channels.fetch(command.team1VoiceChannelId);
    const team2VoiceChannel = await guild.channels.fetch(command.team2VoiceChannelId);
    const resultsChannel =
      command.resultsChannelId === undefined
        ? null
        : await guild.channels.fetch(command.resultsChannelId);

    if (lobbyTextChannel === null) throw new Error('Lobby text channel not found');
    if (lobbyVoiceChannel === null) throw new Error('Lobby voice channel not found');
    if (team1VoiceChannel === null) throw new Error('Team 1 voice channel not found');
    if (team2VoiceChannel === null) throw new Error('Team 2 voice channel not found');
    if (command.resultsChannelId !== undefined && resultsChannel === null)
      throw new Error('Results channel not found');

    if (lobbyTextChannel.type !== ChannelType.GuildText)
      throw new Error('Lobby text channel must be a text channel');
    if (lobbyVoiceChannel.type !== ChannelType.GuildVoice)
      throw new Error('Lobby voice channel must be a voice channel');
    if (team1VoiceChannel.type !== ChannelType.GuildVoice)
      throw new Error('Team 1 voice channel must be a voice channel');
    if (team2VoiceChannel.type !== ChannelType.GuildVoice)
      throw new Error('Team 2 voice channel must be a voice channel');
    if (resultsChannel !== null && resultsChannel.type !== ChannelType.GuildText)
      throw new Error('Results channel must be a text channel');

    this.assertPermissions(botMember, [
      {
        channel: lobbyTextChannel,
        label: 'lobby text channel',
        required: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        channel: lobbyVoiceChannel,
        label: 'lobby voice channel',
        required: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        channel: team1VoiceChannel,
        label: 'team 1 voice channel',
        required: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        channel: team2VoiceChannel,
        label: 'team 2 voice channel',
        required: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
        ],
      },
    ]);

    const roles: Role[] = [];
    for (const roleId of [
      ...command.privilegedRoleIds,
      ...command.moderatorRoleIds,
      ...command.administratorRoleIds,
    ]) {
      const role = await guild.roles.fetch(roleId);
      if (role === null) throw new Error(`Role ${roleId} not found`);
      roles.push(role);
    }

    const profileKey = command.defaultGameProfileKey ?? 'competitive_5v5';
    const profile = await this.prisma.gameProfile.findUnique({ where: { key: profileKey } });
    if (profile === null || !profile.enabled)
      throw new Error(`Game profile ${profileKey} does not exist or is disabled`);
    const effectiveQueueSize = command.queueSize ?? existing?.queueSize ?? 10;
    try {
      const parsedProfile = gameProfileSchema.parse({
        ...profile,
        matchzy: { ...(profile.matchzyOptions as object), cvars: profile.allowedCvars },
      });
      assertCompetitiveBo1FiveVFive(parsedProfile);
    } catch {
      throw new Error(
        'The selected game profile is not supported by the competitive 10man release',
      );
    }
    if (effectiveQueueSize !== profile.playersPerTeam * 2)
      throw new Error(
        `Queue size must be ${String(profile.playersPerTeam * 2)} for profile ${profileKey}`,
      );

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const latest = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if (latest !== null && latest.managedResourceState !== 'NONE') {
        throw new Error(
          'Managed channels must be torn down or recovered before manual configuration',
        );
      }
      if (
        command.expectedVersion !== undefined &&
        (latest?.version ?? null) !== command.expectedVersion
      ) {
        throw new Error('Configuration changed; reload and try again');
      }
      await transaction.guildSettings.upsert({
        where: { guildId: command.guildId },
        create: { guildId: command.guildId },
        update: {},
      });
      await transaction.tenManSettings.upsert({
        where: { guildId: command.guildId },
        create: {
          guildId: command.guildId,
          lobbyTextChannelId: command.lobbyTextChannelId,
          lobbyVoiceChannelId: command.lobbyVoiceChannelId,
          team1VoiceChannelId: command.team1VoiceChannelId,
          team2VoiceChannelId: command.team2VoiceChannelId,
          ...(command.resultsChannelId === undefined
            ? {}
            : { resultsChannelId: command.resultsChannelId }),
          privilegedRoleIds: command.privilegedRoleIds,
          moderatorRoleIds: command.moderatorRoleIds,
          administratorRoleIds: command.administratorRoleIds,
          dathostTemplateServerId: command.dathostTemplateServerId,
          defaultServerLocation: command.defaultServerLocation ?? 'dallas',
          defaultGameProfileKey: profileKey,
          enabled: command.enabled ?? true,
          ...(command.queueSize === undefined ? {} : { queueSize: command.queueSize }),
          ...(command.partyEnabled === undefined ? {} : { partyEnabled: command.partyEnabled }),
          ...(command.readyTimeoutSeconds === undefined
            ? {}
            : { readyTimeoutSeconds: command.readyTimeoutSeconds }),
          ...(command.teamSelectionMode === undefined
            ? {}
            : { teamSelectionMode: command.teamSelectionMode }),
          ...(command.mapSelectionMode === undefined
            ? {}
            : { mapSelectionMode: command.mapSelectionMode }),
        },
        update: {
          lobbyTextChannelId: command.lobbyTextChannelId,
          lobbyVoiceChannelId: command.lobbyVoiceChannelId,
          team1VoiceChannelId: command.team1VoiceChannelId,
          team2VoiceChannelId: command.team2VoiceChannelId,
          ...(command.resultsChannelId === undefined
            ? {}
            : { resultsChannelId: command.resultsChannelId }),
          privilegedRoleIds: command.privilegedRoleIds,
          moderatorRoleIds: command.moderatorRoleIds,
          administratorRoleIds: command.administratorRoleIds,
          dathostTemplateServerId: command.dathostTemplateServerId,
          defaultServerLocation: command.defaultServerLocation ?? 'dallas',
          defaultGameProfileKey: profileKey,
          enabled: command.enabled ?? true,
          ...(command.queueSize === undefined ? {} : { queueSize: command.queueSize }),
          ...(command.partyEnabled === undefined ? {} : { partyEnabled: command.partyEnabled }),
          ...(command.readyTimeoutSeconds === undefined
            ? {}
            : { readyTimeoutSeconds: command.readyTimeoutSeconds }),
          ...(command.teamSelectionMode === undefined
            ? {}
            : { teamSelectionMode: command.teamSelectionMode }),
          ...(command.mapSelectionMode === undefined
            ? {}
            : { mapSelectionMode: command.mapSelectionMode }),
          version: { increment: 1 },
        },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'guild_settings_updated',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {
            dathostTemplateServerId: command.dathostTemplateServerId,
            defaultServerLocation: command.defaultServerLocation ?? 'dallas',
            defaultGameProfileKey: profileKey,
            queueSize: command.queueSize,
            partyEnabled: command.partyEnabled,
            readyTimeoutSeconds: command.readyTimeoutSeconds,
            teamSelectionMode: command.teamSelectionMode,
            mapSelectionMode: command.mapSelectionMode,
          },
        },
      });
    });
  }

  private assertPermissions(
    botMember: {
      permissionsIn: (channel: GuildBasedChannel) => { has: (permission: bigint) => boolean };
    },
    checks: readonly ChannelPermissionCheck[],
  ): void {
    for (const check of checks) {
      const permissions = botMember.permissionsIn(check.channel);
      const missing = check.required.filter((permission) => !permissions.has(permission));
      if (missing.length > 0) {
        throw new Error(
          `Bot is missing required permissions in ${check.label}: ${missing.map((p) => String(p)).join(', ')}`,
        );
      }
    }
  }
}
