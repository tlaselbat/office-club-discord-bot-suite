import { randomUUID } from 'node:crypto';
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildChannel,
} from 'discord.js';
import type { Logger } from 'pino';
import type {
  TenManSettings,
  ManagedSetupStep,
  PrismaClient,
} from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { assertCompetitiveBo1FiveVFive, gameProfileSchema } from '../domain/game-profile.js';

export interface ManagedSetupCommand {
  guildId: string;
  actorDiscordUserId: string;
  correlationId: string;
  privilegedRoleId?: string;
  moderatorRoleId?: string;
  administratorRoleId?: string;
  dathostTemplateServerId?: string;
  defaultServerLocation?: string;
  defaultGameProfileKey?: string;
}

interface ResolvedSetup {
  privilegedRoleIds: string[];
  moderatorRoleIds: string[];
  administratorRoleIds: string[];
  dathostTemplateServerId: string;
  defaultServerLocation: string;
  defaultGameProfileKey: string;
}

type LegacyManagedSetup = TenManSettings & {
  adminChannelId: null;
  managedCategoryId: string;
};

export interface ManagedPreview {
  settingsVersion: number;
  attemptId: string | null;
  categoryId: string | null;
  channelIds: string[];
  setupStep: ManagedSetupStep | null;
}

const resources = [
  { step: 'CATEGORY' as const, name: 'Competitive', type: ChannelType.GuildCategory },
  { step: 'ADMIN_TEXT' as const, name: 'admin', type: ChannelType.GuildText },
  { step: 'LOBBY_TEXT' as const, name: 'match-queue', type: ChannelType.GuildText },
  { step: 'LOBBY_VOICE' as const, name: 'Match Lobby', type: ChannelType.GuildVoice },
  { step: 'TEAM1_VOICE' as const, name: 'Team 1', type: ChannelType.GuildVoice },
  { step: 'TEAM2_VOICE' as const, name: 'Team 2', type: ChannelType.GuildVoice },
] as const;

const ARCHIVE_PREFIX = 'archived-competitive-';

function archivedName(name: string): string {
  return name.startsWith(ARCHIVE_PREFIX) ? name : `${ARCHIVE_PREFIX}${name}`.slice(0, 100);
}

export class GuildResourceService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  public async setup(command: ManagedSetupCommand): Promise<ManagedPreview> {
    const guild = await this.client.guilds.fetch(command.guildId);
    await this.assertManageChannels(guild);
    const existing = await this.prisma.tenManSettings.findUnique({
      where: { guildId: command.guildId },
    });
    if (this.requiresAdminChannelUpgrade(existing)) {
      // An upgrade adds only the missing channel. It must preserve the stored
      // roles/template/profile rather than silently applying optional setup
      // arguments to a single channel's permission overwrites.
      const resolved = await this.resolveSetup(
        {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          correlationId: command.correlationId,
        },
        existing,
        guild,
      );
      return this.addAdminChannelToLegacySetup(command, existing, guild, resolved);
    }
    this.assertSetupAvailable(existing);
    const resolved = await this.resolveSetup(command, existing, guild);
    const attemptId = randomUUID();
    let version = await this.reserveSetup(command, resolved, attemptId, existing?.version);
    let categoryId: string | null = null;
    const channelIds: string[] = [];
    try {
      for (const resource of resources) {
        version = await this.markCreateInFlight(
          command.guildId,
          attemptId,
          version,
          `${resource.step}_CREATE_IN_FLIGHT`,
        );
        const channel = await this.createManagedResource(
          guild,
          resource,
          categoryId,
          resolved,
          command.actorDiscordUserId,
        );
        if (resource.type === ChannelType.GuildCategory) categoryId = channel.id;
        else channelIds.push(channel.id);
        version = await this.persistCreatedResource(
          command,
          attemptId,
          version,
          `${resource.step}_CREATED`,
          channel.id,
          resource.type === ChannelType.GuildCategory,
        );
      }
      await this.validateCreatedChannels(guild, channelIds);
      await this.finalizeSetup(command, attemptId, version, categoryId, channelIds);
      return { settingsVersion: version + 1, attemptId, categoryId, channelIds, setupStep: null };
    } catch (error: unknown) {
      this.logger.error(
        { err: error, guildId: command.guildId, attemptId },
        'Managed setup failed',
      );
      await this.rollbackTracked(
        command.guildId,
        attemptId,
        command.actorDiscordUserId,
        command.correlationId,
        true,
      );
      throw error;
    }
  }

  public async disable(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const settings = await transaction.tenManSettings.findUnique({ where: { guildId } });
      if (settings === null)
        throw new PublicError('GUILD_NOT_CONFIGURED', 'This server is not configured.');
      if (!settings.enabled) return false;
      await transaction.tenManSettings.update({
        where: { guildId },
        data: { enabled: false, version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'guild_disabled',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
      return true;
    });
  }

  public async enable(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<boolean> {
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (settings === null)
      throw new PublicError('GUILD_NOT_CONFIGURED', 'This server is not configured.');
    if (
      settings.managedResourceState === 'SETTING_UP' ||
      settings.managedResourceState === 'TEARING_DOWN'
    ) {
      throw new PublicError(
        'ENABLE_CONFIGURATION_INVALID',
        'Managed channel recovery must complete before this server can be enabled.',
      );
    }
    if (
      [
        settings.lobbyTextChannelId,
        settings.adminChannelId,
        settings.lobbyVoiceChannelId,
        settings.team1VoiceChannelId,
        settings.team2VoiceChannelId,
      ].some((id) => id === null)
    ) {
      throw new PublicError(
        'ENABLE_REQUIRES_SETUP',
        'Managed channels are not configured. Run `/match config setup`.',
      );
    }
    await this.validateExisting(settings);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const updated = await transaction.tenManSettings.updateMany({
        where: { guildId, version: settings.version },
        data: { enabled: true, version: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; run the command again.',
        );
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'guild_enabled',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
      return !settings.enabled;
    });
  }

  public async teardownPreview(guildId: string): Promise<ManagedPreview> {
    const settings = await this.requireManagedSettings(guildId);
    if (settings.managedResourceState === 'SETTING_UP') {
      throw new PublicError(
        'SETUP_IN_PROGRESS',
        'Managed setup recovery is required. Run `/match config recover-setup`.',
      );
    }
    await this.assertNoActiveMatch(guildId);
    return this.preview(settings);
  }

  public async recoverPreview(guildId: string): Promise<ManagedPreview> {
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (settings === null || settings.managedResourceState !== 'SETTING_UP') {
      throw new PublicError(
        'NO_SETUP_RECOVERY',
        'There is no interrupted managed setup to recover.',
      );
    }
    return this.preview(settings);
  }

  public async recoverSetup(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
    expectedVersion: number,
  ): Promise<void> {
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (
      settings === null ||
      settings.version !== expectedVersion ||
      settings.managedResourceState !== 'SETTING_UP'
    ) {
      throw new PublicError('STALE_CONFIGURATION', 'Managed setup changed; run recovery again.');
    }
    await this.rollbackTracked(
      guildId,
      settings.managedAttemptId,
      actorDiscordUserId,
      correlationId,
    );
  }

  public async teardown(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const active = await transaction.match.findFirst({
        where: { guildId, guildSlotActive: true },
        select: { id: true },
      });
      if (active !== null)
        throw new PublicError(
          'ACTIVE_MATCH_BLOCKS_TEARDOWN',
          'Finish the active match and cleanup before teardown.',
        );
      const settings = await transaction.tenManSettings.findUnique({ where: { guildId } });
      if (
        settings === null ||
        settings.version !== expectedVersion ||
        !['ACTIVE', 'TEARING_DOWN'].includes(settings.managedResourceState)
      ) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Managed configuration changed; run teardown again.',
        );
      }
      await transaction.tenManSettings.update({
        where: { guildId },
        data: {
          enabled: false,
          lobbyTextChannelId: null,
          adminChannelId: null,
          lobbyVoiceChannelId: null,
          team1VoiceChannelId: null,
          team2VoiceChannelId: null,
          managedResourceState: 'TEARING_DOWN',
          version: { increment: 1 },
        },
      });
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'guild_teardown_started',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
    await this.archiveTracked(guildId, actorDiscordUserId, correlationId);
  }

  private async resolveSetup(
    command: ManagedSetupCommand,
    existing: TenManSettings | null,
    guild: Guild,
  ): Promise<ResolvedSetup> {
    const privilegedRoleId = command.privilegedRoleId ?? existing?.privilegedRoleIds[0];
    const moderatorRoleId = command.moderatorRoleId ?? existing?.moderatorRoleIds[0];
    const administratorRoleId = command.administratorRoleId ?? existing?.administratorRoleIds[0];
    const dathostTemplateServerId =
      command.dathostTemplateServerId ?? existing?.dathostTemplateServerId ?? undefined;
    const missing = [
      privilegedRoleId === undefined ? 'privileged_role' : null,
      moderatorRoleId === undefined ? 'moderator_role' : null,
      administratorRoleId === undefined ? 'administrator_role' : null,
      dathostTemplateServerId === undefined ? 'dathost_template_server_id' : null,
    ].filter((value): value is string => value !== null);
    if (missing.length > 0)
      throw new PublicError('SETUP_MISSING_OPTIONS', `Setup requires: ${missing.join(', ')}.`);
    if (
      privilegedRoleId === undefined ||
      moderatorRoleId === undefined ||
      administratorRoleId === undefined ||
      dathostTemplateServerId === undefined
    )
      throw new Error('Resolved setup is incomplete');
    for (const roleId of [privilegedRoleId, moderatorRoleId, administratorRoleId]) {
      if ((await guild.roles.fetch(roleId)) === null)
        throw new PublicError('ROLE_NOT_FOUND', `Configured role ${roleId} was not found.`);
    }
    const defaultGameProfileKey =
      command.defaultGameProfileKey ?? existing?.defaultGameProfileKey ?? 'competitive_5v5';
    const profile = await this.prisma.gameProfile.findUnique({
      where: { key: defaultGameProfileKey },
    });
    if (profile === null || !profile.enabled)
      throw new PublicError('PROFILE_UNAVAILABLE', 'The selected game profile is unavailable.');
    try {
      assertCompetitiveBo1FiveVFive(
        gameProfileSchema.parse({
          ...profile,
          matchzy: { ...(profile.matchzyOptions as object), cvars: profile.allowedCvars },
        }),
      );
    } catch {
      throw new PublicError(
        'PROFILE_UNAVAILABLE',
        'The selected game profile is not supported by the competitive release.',
      );
    }
    return {
      privilegedRoleIds: [privilegedRoleId],
      moderatorRoleIds: [moderatorRoleId],
      administratorRoleIds: [administratorRoleId],
      dathostTemplateServerId,
      defaultServerLocation:
        command.defaultServerLocation ?? existing?.defaultServerLocation ?? 'dallas',
      defaultGameProfileKey,
    };
  }

  private assertSetupAvailable(settings: TenManSettings | null): void {
    if (settings === null) return;
    const clean =
      !settings.enabled &&
      settings.managedResourceState === 'NONE' &&
      settings.managedCategoryId === null &&
      settings.managedChannelIds.length === 0 &&
      [
        settings.lobbyTextChannelId,
        settings.adminChannelId,
        settings.lobbyVoiceChannelId,
        settings.team1VoiceChannelId,
        settings.team2VoiceChannelId,
      ].every((id) => id === null);
    if (!clean)
      throw new PublicError(
        'SETUP_ALREADY_CONFIGURED',
        'This server is already configured or requires managed-resource recovery.',
      );
  }

  /** Adds the Admin surface to installations created before that managed resource existed. */
  private requiresAdminChannelUpgrade(
    settings: TenManSettings | null,
  ): settings is LegacyManagedSetup {
    return (
      settings !== null &&
      settings.enabled &&
      settings.managedResourceState === 'ACTIVE' &&
      settings.adminChannelId === null &&
      settings.managedCategoryId !== null &&
      settings.managedChannelIds.length === 4 &&
      [
        settings.lobbyTextChannelId,
        settings.lobbyVoiceChannelId,
        settings.team1VoiceChannelId,
        settings.team2VoiceChannelId,
      ].every((id) => id !== null)
    );
  }

  private async addAdminChannelToLegacySetup(
    command: ManagedSetupCommand,
    settings: TenManSettings,
    guild: Guild,
    resolved: ResolvedSetup,
  ): Promise<ManagedPreview> {
    const adminChannel = await this.createManagedResource(
      guild,
      resources[1],
      settings.managedCategoryId,
      resolved,
      command.actorDiscordUserId,
    );
    await this.validateCreatedChannels(guild, [adminChannel.id, ...settings.managedChannelIds]);
    const updated = await this.prisma.tenManSettings.updateMany({
      where: {
        guildId: command.guildId,
        version: settings.version,
        managedResourceState: 'ACTIVE',
        adminChannelId: null,
      },
      data: {
        adminChannelId: adminChannel.id,
        managedChannelIds: { push: adminChannel.id },
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new PublicError(
        'STALE_CONFIGURATION',
        'Configuration changed while adding the Admin channel; run setup again.',
      );
    await this.prisma.auditEvent.create({
      data: {
        guildId: command.guildId,
        actorDiscordUserId: command.actorDiscordUserId,
        eventType: 'guild_admin_channel_upgraded',
        result: 'success',
        correlationId: command.correlationId,
        metadata: { adminChannelId: adminChannel.id },
      },
    });
    return {
      settingsVersion: settings.version + 1,
      attemptId: settings.managedAttemptId,
      categoryId: settings.managedCategoryId,
      channelIds: [adminChannel.id, ...settings.managedChannelIds],
      setupStep: null,
    };
  }

  private async reserveSetup(
    command: ManagedSetupCommand,
    resolved: ResolvedSetup,
    attemptId: string,
    expectedVersion?: number,
  ): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const current = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if ((current?.version ?? undefined) !== expectedVersion)
        throw new PublicError('STALE_CONFIGURATION', 'Configuration changed; run setup again.');
      await transaction.guildSettings.upsert({
        where: { guildId: command.guildId },
        create: { guildId: command.guildId },
        update: {},
      });
      const saved = await transaction.tenManSettings.upsert({
        where: { guildId: command.guildId },
        create: {
          guildId: command.guildId,
          ...resolved,
          enabled: false,
          managedResourceState: 'SETTING_UP',
          managedSetupStep: 'RESERVED',
          managedAttemptId: attemptId,
        },
        update: {
          ...resolved,
          enabled: false,
          managedResourceState: 'SETTING_UP',
          managedSetupStep: 'RESERVED',
          managedAttemptId: attemptId,
          managedCategoryId: null,
          managedChannelIds: [],
          adminChannelId: null,
          managedResourcesCreatedAt: null,
          version: { increment: 1 },
        },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'guild_managed_setup_started',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { attemptId },
        },
      });
      return saved.version;
    });
  }

  private async markCreateInFlight(
    guildId: string,
    attemptId: string,
    version: number,
    step: ManagedSetupStep,
  ): Promise<number> {
    return this.updateSetupState(guildId, attemptId, version, { managedSetupStep: step });
  }

  private async persistCreatedResource(
    command: ManagedSetupCommand,
    attemptId: string,
    version: number,
    step: ManagedSetupStep,
    resourceId: string,
    category: boolean,
  ): Promise<number> {
    const next = await this.updateSetupState(
      command.guildId,
      attemptId,
      version,
      category
        ? { managedSetupStep: step, managedCategoryId: resourceId }
        : { managedSetupStep: step, managedChannelIds: { push: resourceId } },
    );
    await this.prisma.auditEvent.create({
      data: {
        guildId: command.guildId,
        actorDiscordUserId: command.actorDiscordUserId,
        eventType: 'guild_managed_resource_created',
        result: 'success',
        correlationId: command.correlationId,
        metadata: { attemptId, resourceId },
      },
    });
    return next;
  }

  private async updateSetupState(
    guildId: string,
    attemptId: string,
    version: number,
    data: object,
  ): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const updated = await transaction.tenManSettings.updateMany({
        where: {
          guildId,
          version,
          managedAttemptId: attemptId,
          managedResourceState: 'SETTING_UP',
        },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Managed setup changed; recovery is required.',
        );
      return version + 1;
    });
  }

  private async finalizeSetup(
    command: ManagedSetupCommand,
    attemptId: string,
    version: number,
    categoryId: string | null,
    channelIds: string[],
  ): Promise<void> {
    if (categoryId === null || channelIds.length !== 5)
      throw new Error('Managed setup resources are incomplete');
    const [
      adminChannelId,
      lobbyTextChannelId,
      lobbyVoiceChannelId,
      team1VoiceChannelId,
      team2VoiceChannelId,
    ] = channelIds;
    if (
      adminChannelId === undefined ||
      lobbyTextChannelId === undefined ||
      lobbyVoiceChannelId === undefined ||
      team1VoiceChannelId === undefined ||
      team2VoiceChannelId === undefined
    )
      throw new Error('Managed setup resources are incomplete');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const updated = await transaction.tenManSettings.updateMany({
        where: {
          guildId: command.guildId,
          version,
          managedAttemptId: attemptId,
          managedResourceState: 'SETTING_UP',
        },
        data: {
          lobbyTextChannelId,
          adminChannelId,
          lobbyVoiceChannelId,
          team1VoiceChannelId,
          team2VoiceChannelId,
          enabled: true,
          managedResourceState: 'ACTIVE',
          managedSetupStep: null,
          managedResourcesCreatedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Managed setup changed; recovery is required.',
        );
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'guild_managed_setup_completed',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { attemptId, categoryId, channelIds },
        },
      });
    });
  }

  private async rollbackTracked(
    guildId: string,
    attemptId: string | null,
    actorDiscordUserId: string,
    correlationId: string,
    preserveAmbiguity = false,
  ): Promise<void> {
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (settings === null || settings.managedAttemptId !== attemptId) return;
    await this.archiveTracked(guildId, actorDiscordUserId, correlationId, preserveAmbiguity);
  }

  /** Never delete Discord channels; final removal is an administrator action. */
  private async archiveTracked(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
    preserveAmbiguity = false,
  ): Promise<void> {
    const guild = await this.client.guilds.fetch(guildId);
    await this.assertManageChannels(guild);
    let settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (settings === null) return;
    for (const id of [...settings.managedChannelIds].reverse()) {
      const channel = await guild.channels.fetch(id).catch(() => null);
      if (channel !== null) await this.archiveChannel(channel, guild, actorDiscordUserId);
      await this.removeManagedId(guildId, id, false, actorDiscordUserId, correlationId);
    }
    settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (settings?.managedCategoryId !== null && settings?.managedCategoryId !== undefined) {
      const category = await guild.channels.fetch(settings.managedCategoryId).catch(() => null);
      if (category !== null) await this.archiveChannel(category, guild, actorDiscordUserId);
      await this.removeManagedId(
        guildId,
        settings.managedCategoryId,
        true,
        actorDiscordUserId,
        correlationId,
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const current = await transaction.tenManSettings.findUnique({ where: { guildId } });
      if (
        current === null ||
        current.managedChannelIds.length > 0 ||
        current.managedCategoryId !== null ||
        (preserveAmbiguity && current.managedSetupStep?.endsWith('_CREATE_IN_FLIGHT'))
      )
        return;
      await transaction.tenManSettings.update({
        where: { guildId },
        data: {
          enabled: false,
          managedResourceState: 'NONE',
          managedSetupStep: null,
          managedAttemptId: null,
          managedResourcesCreatedAt: null,
          version: { increment: 1 },
        },
      });
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'guild_managed_archive_completed',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
  }

  private async removeManagedId(
    guildId: string,
    resourceId: string,
    category: boolean,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const settings = await transaction.tenManSettings.findUnique({ where: { guildId } });
      if (settings === null) return;
      await transaction.tenManSettings.update({
        where: { guildId },
        data: category
          ? { managedCategoryId: null, version: { increment: 1 } }
          : {
              managedChannelIds: settings.managedChannelIds.filter((id) => id !== resourceId),
              version: { increment: 1 },
            },
      });
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType: 'guild_managed_resource_archived',
          result: 'success',
          correlationId,
          metadata: { resourceId },
        },
      });
    });
  }

  private async requireManagedSettings(guildId: string): Promise<TenManSettings> {
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (
      settings === null ||
      settings.managedResourceState === 'NONE' ||
      (settings.managedCategoryId === null && settings.managedChannelIds.length === 0)
    )
      throw new PublicError(
        'NO_MANAGED_RESOURCES',
        'No bot-managed channels are available to archive. Manually configured channels are never changed.',
      );
    return settings;
  }

  private preview(settings: TenManSettings): ManagedPreview {
    return {
      settingsVersion: settings.version,
      attemptId: settings.managedAttemptId,
      categoryId: settings.managedCategoryId,
      channelIds: settings.managedChannelIds,
      setupStep: settings.managedSetupStep,
    };
  }

  private async archiveChannel(
    channel: GuildBasedChannel,
    guild: Guild,
    actorDiscordUserId: string,
  ): Promise<void> {
    const reason = `Office Club Competitive managed archive by ${actorDiscordUserId}; manual deletion required`;
    await channel.edit({ name: archivedName(channel.name), reason });
    await (channel as GuildChannel).permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
      SendMessages: false,
      Connect: false,
      Speak: false,
    });
  }

  private async assertNoActiveMatch(guildId: string): Promise<void> {
    const active = await this.prisma.match.findFirst({
      where: { guildId, guildSlotActive: true },
      select: { id: true },
    });
    if (active !== null)
      throw new PublicError(
        'ACTIVE_MATCH_BLOCKS_TEARDOWN',
        'Finish the active match and cleanup before teardown.',
      );
  }

  private async assertManageChannels(guild: Guild): Promise<void> {
    const member = guild.members.me ?? (await guild.members.fetch(this.client.user?.id ?? ''));
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels))
      throw new PublicError(
        'MANAGE_CHANNELS_REQUIRED',
        'The bot needs Manage Channels permission for managed setup or teardown.',
      );
  }

  private async validateCreatedChannels(guild: Guild, channelIds: string[]): Promise<void> {
    const botMember = guild.members.me ?? (await guild.members.fetch(this.client.user?.id ?? ''));
    const channels = await Promise.all(channelIds.map((id) => guild.channels.fetch(id)));
    const expected = [
      ChannelType.GuildText,
      ChannelType.GuildText,
      ChannelType.GuildVoice,
      ChannelType.GuildVoice,
      ChannelType.GuildVoice,
    ];
    for (const [index, channel] of channels.entries()) {
      if (channel === null || channel.type !== expected[index])
        throw new PublicError('SETUP_VALIDATION_FAILED', 'A created channel has the wrong type.');
      const permissions = botMember.permissionsIn(channel);
      const required =
        index <= 1
          ? [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory,
            ]
          : [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.MoveMembers,
            ];
      if (required.some((permission) => !permissions.has(permission))) {
        throw new PublicError(
          'SETUP_VALIDATION_FAILED',
          'The bot lacks required permissions in the created channels.',
        );
      }
    }
  }

  private async validateExisting(settings: TenManSettings): Promise<void> {
    const guild = await this.client.guilds.fetch(settings.guildId);
    const ids = [
      settings.lobbyTextChannelId,
      settings.adminChannelId,
      settings.lobbyVoiceChannelId,
      settings.team1VoiceChannelId,
      settings.team2VoiceChannelId,
    ];
    const channels = await Promise.all(
      ids.map((id) => (id === null ? null : guild.channels.fetch(id).catch(() => null))),
    );
    if (channels.some((channel) => channel === null))
      throw new PublicError(
        'ENABLE_CONFIGURATION_INVALID',
        'One or more configured channels are missing. Run diagnostics.',
      );
    const expected = [
      ChannelType.GuildText,
      ChannelType.GuildText,
      ChannelType.GuildVoice,
      ChannelType.GuildVoice,
      ChannelType.GuildVoice,
    ];
    if (channels.some((channel, index) => channel?.type !== expected[index]))
      throw new PublicError(
        'ENABLE_CONFIGURATION_INVALID',
        'One or more configured channels have the wrong type.',
      );
    for (const roleId of [
      ...settings.privilegedRoleIds,
      ...settings.moderatorRoleIds,
      ...settings.administratorRoleIds,
    ])
      if ((await guild.roles.fetch(roleId).catch(() => null)) === null)
        throw new PublicError(
          'ENABLE_CONFIGURATION_INVALID',
          'One or more configured roles are missing.',
        );
    if (settings.defaultGameProfileKey === null || settings.dathostTemplateServerId === null)
      throw new PublicError(
        'ENABLE_CONFIGURATION_INVALID',
        'Profile or DatHost template configuration is missing.',
      );
    const profile = await this.prisma.gameProfile.findUnique({
      where: { key: settings.defaultGameProfileKey },
    });
    if (profile === null || !profile.enabled)
      throw new PublicError(
        'ENABLE_CONFIGURATION_INVALID',
        'The configured game profile is unavailable.',
      );
    const botMember = guild.members.me ?? (await guild.members.fetch(this.client.user?.id ?? ''));
    const required = [
      [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
      [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.MoveMembers,
      ],
    ];
    for (const [index, channel] of channels.entries()) {
      const permissions = botMember.permissionsIn(channel as GuildBasedChannel);
      for (const permission of required[index <= 1 ? 0 : 1] ?? [])
        if (!permissions.has(permission))
          throw new PublicError(
            'ENABLE_CONFIGURATION_INVALID',
            'The bot is missing required channel permissions.',
          );
    }
  }

  private async createManagedResource(
    guild: Guild,
    resource: (typeof resources)[number],
    categoryId: string | null,
    resolved: ResolvedSetup,
    actorDiscordUserId: string,
  ): Promise<GuildBasedChannel> {
    const isAdminChannel = resource.step === 'ADMIN_TEXT';
    return guild.channels.create({
      name: resource.name,
      type: resource.type,
      ...(resource.type === ChannelType.GuildCategory ? {} : { parent: categoryId }),
      ...(isAdminChannel
        ? { permissionOverwrites: this.adminChannelPermissionOverwrites(guild, resolved) }
        : {}),
      reason: `Office Club Competitive managed setup by ${actorDiscordUserId}`,
    });
  }

  private adminChannelPermissionOverwrites(guild: Guild, resolved: ResolvedSetup) {
    const botUserId = guild.members.me?.id ?? this.client.user?.id;
    if (botUserId === undefined)
      throw new PublicError(
        'SETUP_VALIDATION_FAILED',
        'The bot identity is unavailable while creating the Admin channel.',
      );
    const staffRoleIds = [
      ...new Set([...resolved.moderatorRoleIds, ...resolved.administratorRoleIds]),
    ];
    if (staffRoleIds.includes(guild.roles.everyone.id))
      throw new PublicError(
        'SETUP_MISSING_OPTIONS',
        'The @everyone role cannot be used for Admin channel access.',
      );
    return [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      ...staffRoleIds.map((id) => ({
        id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
      {
        id: botUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
  }
}
