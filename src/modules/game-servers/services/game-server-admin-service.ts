import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Client, GuildBasedChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import type { DatHostServerReader } from '../../../integrations/dathost/client.js';
import { scheduleGameServerPoll } from '../poll-service.js';
import type { GameServerPanelService } from '../panel-service.js';
import { scheduleGameServerUpdateReconcile } from '../update-thread-service.js';

const panelChannelPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
];

function assertHttpsUrl(value: string | null | undefined, label: string): void {
  if (value === undefined || value === null || value === '') return;
  if (!/^https:\/\//i.test(value)) throw new PublicError('INVALID_URL', `${label} must use HTTPS`);
}

function isSupportedCs2(game: string | null | undefined): boolean {
  return game === 'cs2' || game === 'csgo';
}

export interface SetGameServerModuleEnabledCommand {
  guildId: string;
  actorDiscordUserId: string;
  correlationId: string;
  enabled: boolean;
  expectedVersion: number;
}

export interface UpdateGameServerPanelDestinationCommand {
  guildId: string;
  actorDiscordUserId: string;
  correlationId: string;
  panelChannelId: string;
  expectedVersion: number | null;
}

export interface CreateGameServerCommand {
  guildId: string;
  actorDiscordUserId: string;
  correlationId: string;
  displayName: string;
  providerServerId: string;
}

export interface UpdateGameServerCommand {
  guildId: string;
  gameServerId: string;
  actorDiscordUserId: string;
  correlationId: string;
  expectedVersion: number;
  displayName?: string | undefined;
  description?: string | null | undefined;
  enabled?: boolean | undefined;
  public?: boolean | undefined;
  connectDomain?: string | null | undefined;
  joinUrl?: string | null | undefined;
  imageUrl?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface ToggleGameServerEnabledCommand {
  guildId: string;
  gameServerId: string;
  actorDiscordUserId: string;
  correlationId: string;
  expectedVersion: number;
  enabled: boolean;
}

export interface ToggleGameServerPublicCommand {
  guildId: string;
  gameServerId: string;
  actorDiscordUserId: string;
  correlationId: string;
  expectedVersion: number;
  public: boolean;
}

export interface RemoveGameServerCommand {
  guildId: string;
  gameServerId: string;
  actorDiscordUserId: string;
  correlationId: string;
}

export interface AddGameServerCardCommand {
  guildId: string;
  gameServerId: string;
  actorDiscordUserId: string;
  correlationId: string;
}

export interface GameServerAdminServiceOptions {
  prisma: PrismaClient;
  discord: Client;
  dathost: DatHostServerReader;
  panelService: GameServerPanelService;
}

export class GameServerAdminService {
  private readonly prisma: PrismaClient;
  private readonly discord: Client;
  private readonly dathost: DatHostServerReader;
  private readonly panelService: GameServerPanelService;

  public constructor(options: GameServerAdminServiceOptions) {
    this.prisma = options.prisma;
    this.discord = options.discord;
    this.dathost = options.dathost;
    this.panelService = options.panelService;
  }

  public async listAvailableServers(
    guildId: string,
  ): Promise<Array<{ id: string; name: string; location: string | null }>> {
    const [inventory, attached] = await Promise.all([
      this.dathost.listServers(),
      this.prisma.gameServer.findMany({
        where: { guildId },
        select: { providerServerId: true },
      }),
    ]);
    const attachedIds = new Set(attached.map((server) => server.providerServerId));
    return inventory
      .filter((server) => isSupportedCs2(server.game) && !attachedIds.has(server.id))
      .map((server) => ({
        id: server.id,
        name: server.name,
        location: server.location ?? null,
      }));
  }

  public async setModuleEnabled(command: SetGameServerModuleEnabledCommand): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'game-server:settings:' + command.guildId}, 0))`;
      const current = await tx.gameServerSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if (current === null || current.version !== command.expectedVersion) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      if (command.enabled) {
        const channel =
          current.panelChannelId === null
            ? null
            : await this.discord.channels.fetch(current.panelChannelId).catch(() => null);
        if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
          throw new PublicError(
            'PANEL_CHANNEL_INVALID',
            'A valid server-card text channel must be configured before enabling Game Servers.',
          );
        }
        assertPanelChannelPermissions(
          channel as unknown as GuildBasedChannel,
          this.discord,
          'Panel channel',
        );
      }
      const toggled = await tx.gameServerSettings.updateMany({
        where: { guildId: command.guildId, version: current.version },
        data: { enabled: command.enabled, version: { increment: 1 } },
      });
      if (toggled.count !== 1) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      if (command.enabled) {
        const servers = await tx.gameServer.findMany({
          where: { guildId: command.guildId, enabled: true },
          select: { id: true, public: true },
        });
        for (const server of servers) {
          await scheduleGameServerPoll(tx, server.id);
          if (server.public) await scheduleGameServerUpdateReconcile(tx, server.id);
        }
      }
      await tx.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: command.enabled ? 'game_server_module_enabled' : 'game_server_module_disabled',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { previousVersion: current.version },
        },
      });
    });
  }

  public async updatePanelDestination(
    command: UpdateGameServerPanelDestinationCommand,
  ): Promise<void> {
    const guild = await this.discord.guilds.fetch(command.guildId);
    const channel = await guild.channels.fetch(command.panelChannelId);
    if (channel === null || channel.type !== ChannelType.GuildText) {
      throw new PublicError('PANEL_CHANNEL_INVALID', 'Select a server text channel.');
    }
    assertPanelChannelPermissions(channel, this.discord, 'Panel channel');

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'game-server:settings:' + command.guildId}, 0))`;
      const current = await tx.gameServerSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if ((current?.version ?? null) !== command.expectedVersion) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      await tx.gameServerSettings.upsert({
        where: { guildId: command.guildId },
        create: {
          guildId: command.guildId,
          panelChannelId: channel.id,
          panelMessageId: null,
        },
        update: {
          panelChannelId: channel.id,
          panelMessageId: null,
          version: { increment: 1 },
        },
      });
      await tx.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'game_server_panel_destination_updated',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { panelChannelId: channel.id },
        },
      });
    });
  }

  public async repairPanel(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<{ reposted: boolean; panelMessageId: string | null }> {
    const result = await this.panelService.reconcile(guildId);
    await this.prisma.auditEvent.create({
      data: {
        guildId,
        actorDiscordUserId,
        eventType: 'game_server_panel_repaired',
        result: 'success',
        correlationId,
        metadata: { reposted: result.reposted, panelMessageId: result.panelMessageId },
      },
    });
    return result;
  }

  public async registerServer(command: CreateGameServerCommand): Promise<{ id: string }> {
    const [providerServer, existing] = await Promise.all([
      this.dathost.getServer(command.providerServerId),
      this.prisma.gameServer.findFirst({
        where: { guildId: command.guildId, providerServerId: command.providerServerId },
      }),
    ]);
    if (providerServer === null) {
      throw new PublicError(
        'DATHOST_SERVER_NOT_FOUND',
        'The selected DatHost server is not accessible.',
      );
    }
    if (!isSupportedCs2(providerServer.game)) {
      throw new PublicError('UNSUPPORTED_GAME', 'Only CS2 / CS:GO DatHost servers are supported.');
    }
    if (existing !== null) {
      throw new PublicError(
        'SERVER_ALREADY_REGISTERED',
        'This DatHost server is already registered.',
      );
    }
    const displayName = command.displayName.trim();
    if (displayName.length === 0 || displayName.length > 64) {
      throw new PublicError('INVALID_DISPLAY_NAME', 'Display name must be 1-64 characters.');
    }
    const registration = await this.prisma.$transaction(async (tx) => {
      await tx.guildSettings.upsert({
        where: { guildId: command.guildId },
        create: { guildId: command.guildId },
        update: {},
      });
      const created = await tx.gameServer.create({
        data: {
          guildId: command.guildId,
          providerServerId: command.providerServerId,
          displayName,
          description: null,
          enabled: true,
          public: true,
        },
      });
      await scheduleGameServerPoll(tx, created.id);
      await tx.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'game_server_created',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {
            gameServerId: created.id,
            displayName,
            providerServerId: command.providerServerId,
          },
        },
      });
      return created;
    });
    return { id: registration.id };
  }

  public async updateServer(command: UpdateGameServerCommand): Promise<void> {
    assertHttpsUrl(command.joinUrl, 'Join URL');
    assertHttpsUrl(command.imageUrl, 'Image URL');
    const displayName = command.displayName?.trim();
    if (displayName !== undefined && (displayName.length === 0 || displayName.length > 64)) {
      throw new PublicError('INVALID_DISPLAY_NAME', 'Display name must be 1-64 characters.');
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.gameServer.findFirst({
        where: { id: command.gameServerId, guildId: command.guildId },
      });
      if (current === null) {
        throw new PublicError('GAME_SERVER_NOT_FOUND', 'Game server registration not found.');
      }
      if (current.version !== command.expectedVersion) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      const updated = await tx.gameServer.updateMany({
        where: { id: command.gameServerId, guildId: command.guildId, version: current.version },
        data: {
          ...(displayName === undefined ? {} : { displayName }),
          ...(command.description === undefined
            ? {}
            : { description: command.description === '' ? null : command.description }),
          ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
          ...(command.public === undefined ? {} : { public: command.public }),
          ...(command.connectDomain === undefined
            ? {}
            : {
                connectDomain:
                  command.connectDomain === '' || command.connectDomain === null
                    ? null
                    : command.connectDomain,
              }),
          ...(command.joinUrl === undefined
            ? {}
            : {
                joinUrl:
                  command.joinUrl === '' || command.joinUrl === null ? null : command.joinUrl,
              }),
          ...(command.imageUrl === undefined
            ? {}
            : {
                imageUrl:
                  command.imageUrl === '' || command.imageUrl === null ? null : command.imageUrl,
              }),
          ...(command.sortOrder === undefined ? {} : { sortOrder: command.sortOrder }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      if (command.enabled === true || command.public === true) {
        await scheduleGameServerUpdateReconcile(tx, command.gameServerId);
      }
      if (command.enabled === true) {
        await scheduleGameServerPoll(tx, command.gameServerId);
      }
      await tx.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'game_server_updated',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {
            gameServerId: command.gameServerId,
            ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
            ...(command.public === undefined ? {} : { public: command.public }),
          },
        },
      });
    });
  }

  public async setServerEnabled(command: ToggleGameServerEnabledCommand): Promise<void> {
    await this.toggleServer(
      command.gameServerId,
      command.guildId,
      command.expectedVersion,
      command.enabled,
      command.actorDiscordUserId,
      command.correlationId,
      'enabled',
    );
  }

  public async setServerPublic(command: ToggleGameServerPublicCommand): Promise<void> {
    await this.toggleServer(
      command.gameServerId,
      command.guildId,
      command.expectedVersion,
      command.public,
      command.actorDiscordUserId,
      command.correlationId,
      'public',
    );
  }

  private async toggleServer(
    gameServerId: string,
    guildId: string,
    expectedVersion: number,
    value: boolean,
    actorDiscordUserId: string,
    correlationId: string,
    field: 'enabled' | 'public',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.gameServer.findFirst({
        where: { id: gameServerId, guildId },
      });
      if (current === null) {
        throw new PublicError('GAME_SERVER_NOT_FOUND', 'Game server registration not found.');
      }
      if (current.version !== expectedVersion) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      await tx.gameServer.updateMany({
        where: { id: gameServerId, guildId, version: current.version },
        data: { [field]: value, version: { increment: 1 } },
      });
      if (field === 'enabled' && value) await scheduleGameServerPoll(tx, gameServerId);
      if (field === 'public' && value) await scheduleGameServerUpdateReconcile(tx, gameServerId);
      await tx.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId,
          eventType:
            field === 'enabled'
              ? value
                ? 'game_server_enabled'
                : 'game_server_disabled'
              : value
                ? 'game_server_made_public'
                : 'game_server_made_private',
          result: 'success',
          correlationId,
          metadata: { gameServerId, [field]: value },
        },
      });
    });
  }

  public async removeServerRegistration(command: RemoveGameServerCommand): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.gameServer.findFirst({
        where: { id: command.gameServerId, guildId: command.guildId },
      });
      if (current === null) {
        throw new PublicError('GAME_SERVER_NOT_FOUND', 'Game server registration not found.');
      }
      await tx.gameServer.delete({ where: { id: command.gameServerId } });
      await tx.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'game_server_removed',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {
            gameServerId: command.gameServerId,
            displayName: current.displayName,
            providerServerId: current.providerServerId,
          },
        },
      });
    });
  }
}

function assertPanelChannelPermissions(
  channel: GuildBasedChannel,
  discord: Client,
  label: string,
): void {
  const botUser = discord.user;
  if (botUser === null) throw new Error('Discord client is not ready');
  const permissions = channel.permissionsFor(botUser);
  if (permissions?.has(panelChannelPermissions) !== true) {
    throw new PublicError(
      'PANEL_CHANNEL_MISSING_PERMISSIONS',
      `The bot needs View Channel, Send Messages, Embed Links, and Read Message History in the ${label}.`,
    );
  }
}
