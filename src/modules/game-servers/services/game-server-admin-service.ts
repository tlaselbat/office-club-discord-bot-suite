import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Client, GuildBasedChannel, GuildTextBasedChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import type { DatHostServerReader } from '../../../integrations/dathost/client.js';
import { scheduleGameServerPoll } from '../poll-service.js';
import { scheduleGameServerCardRefresh, type GameServerCardService } from '../card-service.js';
import type { GameServerPanelService } from '../panel-service.js';
import { scheduleGameServerUpdateReconcile } from '../update-thread-service.js';
import {
  cardProfileSchema,
  isHttpsUrl,
  normalizeCardProfile,
  type CardProfileInput,
} from '../card-profile.js';

const panelChannelPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
];

function assertHttpsUrl(value: string | null | undefined, label: string): void {
  if (value === undefined || value === null || value === '') return;
  if (!isHttpsUrl(value)) {
    throw new PublicError('INVALID_URL', `${label} must be a valid HTTPS URL`);
  }
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
  cardProfile?: CardProfileInput | undefined;
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

export interface PublishGameServerCardCommand extends AddGameServerCardCommand {
  channelId: string;
}

export interface MoveGameServerCardCommand {
  guildId: string;
  cardId: string;
  channelId: string;
  actorDiscordUserId: string;
  correlationId: string;
}

export interface GameServerAdminServiceOptions {
  prisma: PrismaClient;
  discord: Client;
  dathost: DatHostServerReader;
  cardService: GameServerCardService;
  panelService?: GameServerPanelService;
}

export class GameServerAdminService {
  private readonly prisma: PrismaClient;
  private readonly discord: Client;
  private readonly dathost: DatHostServerReader;
  private readonly cardService: GameServerCardService;
  private readonly panelService: GameServerPanelService | undefined;

  public constructor(options: GameServerAdminServiceOptions) {
    this.prisma = options.prisma;
    this.discord = options.discord;
    this.dathost = options.dathost;
    this.cardService = options.cardService;
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
      if (current === null && command.expectedVersion !== 0) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      if (current !== null && current.version !== command.expectedVersion) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      const previousVersion = current?.version ?? 0;
      if (current === null) {
        await tx.guildSettings.upsert({
          where: { guildId: command.guildId },
          create: { guildId: command.guildId },
          update: {},
        });
        await tx.gameServerSettings.create({
          data: { guildId: command.guildId, enabled: command.enabled, version: 1 },
        });
      } else {
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
      }
      if (command.enabled) {
        const servers = await tx.gameServer.findMany({
          where: { guildId: command.guildId, enabled: true },
          select: { id: true, public: true },
        });
        for (const server of servers) {
          await scheduleGameServerPoll(tx, server.id);
          if (server.public) await scheduleGameServerUpdateReconcile(tx, server.id);
          const cards = await tx.gameServerCard.findMany({
            where: { gameServerId: server.id },
            select: { id: true },
          });
          for (const card of cards)
            await scheduleGameServerCardRefresh(
              tx,
              card.id,
              new Date(),
              `module:${String(previousVersion + 1)}`,
            );
        }
      }
      await tx.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: command.enabled ? 'game_server_module_enabled' : 'game_server_module_disabled',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { previousVersion },
        },
      });
    });
  }

  public updatePanelDestination(command: UpdateGameServerPanelDestinationCommand): Promise<void> {
    void command;
    return Promise.reject(
      new PublicError(
        'GAME_SERVER_PANEL_DEPRECATED',
        'The legacy server-card panel destination has been removed. Publish a display to a channel instead.',
      ),
    );
  }

  public async repairPanel(
    guildId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<{ reposted: boolean; panelMessageId: string | null }> {
    if (this.panelService === undefined)
      throw new PublicError(
        'GAME_SERVER_PANEL_DEPRECATED',
        'The legacy server-card panel has been removed.',
      );
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

  public async publishServerCard(
    command: PublishGameServerCardCommand,
  ): Promise<{ cardId: string }> {
    const server = await this.prisma.gameServer.findFirst({
      where: { id: command.gameServerId, guildId: command.guildId },
      select: { id: true },
    });
    if (server === null)
      throw new PublicError('GAME_SERVER_NOT_FOUND', 'Game server registration not found.');
    const channel = await this.getDisplayChannel(command.guildId, command.channelId);
    const deployment = await this.cardService.publishDeployment(server.id, channel);
    await this.prisma.auditEvent.create({
      data: {
        guildId: command.guildId,
        actorDiscordUserId: command.actorDiscordUserId,
        eventType: 'game_server_display_published',
        result: 'success',
        correlationId: command.correlationId,
        metadata: {
          gameServerId: command.gameServerId,
          cardId: deployment.id,
          channelId: command.channelId,
        },
      },
    });
    return { cardId: deployment.id };
  }

  public async removeServerCard(
    command: AddGameServerCardCommand & { cardId: string },
  ): Promise<void> {
    const card = await this.prisma.gameServerCard.findFirst({
      where: { id: command.cardId, guildId: command.guildId, gameServerId: command.gameServerId },
      select: { id: true, channelId: true },
    });
    if (card === null)
      throw new PublicError('GAME_SERVER_CARD_NOT_FOUND', 'Display deployment not found.');
    await this.cardService.removeDeployment(card.id);
    await this.prisma.auditEvent.create({
      data: {
        guildId: command.guildId,
        actorDiscordUserId: command.actorDiscordUserId,
        eventType: 'game_server_display_removed',
        result: 'success',
        correlationId: command.correlationId,
        metadata: {
          gameServerId: command.gameServerId,
          cardId: card.id,
          channelId: card.channelId,
        },
      },
    });
  }

  public async moveServerCard(command: MoveGameServerCardCommand): Promise<{ cardId: string }> {
    const card = await this.prisma.gameServerCard.findFirst({
      where: { id: command.cardId, guildId: command.guildId },
      select: { id: true, gameServerId: true },
    });
    if (card === null)
      throw new PublicError('GAME_SERVER_CARD_NOT_FOUND', 'Display deployment not found.');
    const channel = await this.getDisplayChannel(command.guildId, command.channelId);
    const deployment = await this.cardService.moveDeployment(card.id, channel);
    await this.prisma.auditEvent.create({
      data: {
        guildId: command.guildId,
        actorDiscordUserId: command.actorDiscordUserId,
        eventType: 'game_server_display_moved',
        result: 'success',
        correlationId: command.correlationId,
        metadata: {
          gameServerId: card.gameServerId,
          fromCardId: card.id,
          cardId: deployment.id,
          channelId: command.channelId,
        },
      },
    });
    return { cardId: deployment.id };
  }

  public async reconcileServerCard(guildId: string, cardId: string): Promise<void> {
    const card = await this.prisma.gameServerCard.findFirst({
      where: { id: cardId, guildId },
      select: { id: true },
    });
    if (card === null)
      throw new PublicError('GAME_SERVER_CARD_NOT_FOUND', 'Display deployment not found.');
    await this.cardService.reconcileDeployment(card.id);
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
      await tx.gameServerSettings.upsert({
        where: { guildId: command.guildId },
        create: { guildId: command.guildId, enabled: true },
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
    const parsedProfile =
      command.cardProfile === undefined
        ? undefined
        : cardProfileSchema.safeParse(command.cardProfile);
    if (parsedProfile !== undefined && !parsedProfile.success) {
      throw new PublicError(
        'INVALID_CARD_PROFILE',
        parsedProfile.error.issues.map((issue) => issue.message).join('; '),
      );
    }
    const cardProfile = parsedProfile?.data;
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
      if (
        cardProfile !== undefined &&
        cardProfile.textLines === undefined &&
        normalizeCardProfile(current.cardProfile).textLines !== undefined
      ) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'This card uses configurable text lines; reload the editor before saving.',
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
          ...(cardProfile === undefined ? {} : { cardProfile }),
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
      const affectsCardOutput =
        displayName !== undefined ||
        command.description !== undefined ||
        command.connectDomain !== undefined ||
        command.joinUrl !== undefined ||
        command.imageUrl !== undefined ||
        command.sortOrder !== undefined ||
        cardProfile !== undefined;
      const nextEnabled = command.enabled ?? current.enabled;
      const nextPublic = command.public ?? current.public;
      const reenabled =
        (command.enabled === true && !current.enabled) ||
        (command.public === true && !current.public);
      const privateCleanup = command.public === false;
      if (((affectsCardOutput || reenabled) && nextEnabled && nextPublic) || privateCleanup) {
        const cards = await tx.gameServerCard.findMany({
          where: { gameServerId: command.gameServerId },
          select: { id: true },
        });
        const revision = `${privateCleanup ? 'privacy' : reenabled ? 'eligible' : 'config'}:${String(current.version + 1)}`;
        for (const card of cards)
          await scheduleGameServerCardRefresh(tx, card.id, new Date(), revision);
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
    if (command.public === false) {
      await this.cardService.removeDeploymentsForGameServer(command.gameServerId);
    }
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
      const updated = await tx.gameServer.updateMany({
        where: { id: gameServerId, guildId, version: current.version },
        data: { [field]: value, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new PublicError(
          'STALE_CONFIGURATION',
          'Configuration changed; reload and try again.',
        );
      }
      if (field === 'enabled' && value) await scheduleGameServerPoll(tx, gameServerId);
      if (field === 'public' && value) await scheduleGameServerUpdateReconcile(tx, gameServerId);
      if (value || field === 'public') {
        const cards = await tx.gameServerCard.findMany({
          where: { gameServerId },
          select: { id: true },
        });
        const revision = `${value ? 'eligible' : 'privacy'}:${String(current.version + 1)}`;
        for (const card of cards)
          await scheduleGameServerCardRefresh(tx, card.id, new Date(), revision);
      }
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
    if (field === 'public' && !value)
      await this.cardService.removeDeploymentsForGameServer(gameServerId);
  }

  public async removeServerRegistration(command: RemoveGameServerCommand): Promise<void> {
    const current = await this.prisma.gameServer.findFirst({
      where: { id: command.gameServerId, guildId: command.guildId },
      select: { id: true },
    });
    if (current === null)
      throw new PublicError('GAME_SERVER_NOT_FOUND', 'Game server registration not found.');
    await this.cardService.removeDeploymentsForGameServer(current.id, async () => {
      await this.prisma.$transaction(async (tx) => {
        const registration = await tx.gameServer.findFirst({
          where: { id: command.gameServerId, guildId: command.guildId },
        });
        if (registration === null) {
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
              displayName: registration.displayName,
              providerServerId: registration.providerServerId,
            },
          },
        });
      });
    });
  }

  private async getDisplayChannel(
    guildId: string,
    channelId: string,
  ): Promise<GuildTextBasedChannel> {
    const guild = await this.discord.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (channel === null || channel.type !== ChannelType.GuildText)
      throw new PublicError('GAME_SERVER_TEXT_CHANNEL_REQUIRED', 'Select a server text channel.');
    assertPanelChannelPermissions(channel, this.discord, 'display channel');
    return channel;
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
