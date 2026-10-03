import type { Client, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  renderAdminPanel,
  type AdminPanelSubview,
  type AdminPanelView,
} from '../bot/admin-panel-renderer.js';
import {
  configurationDraftFromSettings,
  type AdminQueueConfigurationView,
} from '../bot/admin-queue-config-components.js';
import { MapPoolService } from './map-pool-service.js';

export type AdminPanelViewRequest =
  | { kind: 'MAIN' }
  | { kind: 'CONFIGURE'; draft?: AdminQueueConfigurationView }
  | { kind: 'MODERATORS' }
  | { kind: 'MAPS'; page?: number };

export class AdminPanelService {
  private readonly mapPoolService: MapPoolService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly secret: string,
  ) {
    this.mapPoolService = new MapPoolService(prisma);
  }

  public async reconcile(
    guildId: string,
    request: AdminPanelViewRequest = { kind: 'MAIN' },
  ): Promise<void> {
    const [settings, queue, moderators] = await Promise.all([
      this.prisma.tenManSettings.findUnique({ where: { guildId } }),
      this.prisma.tenManQueue.findUnique({ where: { guildId }, include: { entries: true } }),
      this.prisma.matchModerator.findMany({
        where: { guildId },
        select: { discordUserId: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (settings === null || settings.adminChannelId === null) return;
    const channel = await this.client.channels.fetch(settings.adminChannelId).catch(() => null);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) return;
    const text = channel as TextChannel;
    const view: AdminPanelView = {
      guildId,
      settingsVersion: settings.version,
      queueVersion: queue?.version ?? 0,
      enabled: settings.enabled,
      queueStatus: queue?.status ?? 'NOT_STARTED',
      queueCount: queue?.entries.length ?? 0,
      queueCapacity: settings.queueSize,
      profile: settings.defaultGameProfileKey,
      location: settings.defaultServerLocation,
      matchModeratorCount: moderators.filter((moderator) => moderator.status === 'ACTIVE').length,
    };
    const payload = renderAdminPanel(
      view,
      this.secret,
      await this.buildSubview(guildId, settings, moderators, request),
    );
    const existing =
      settings.adminPanelMessageId === null
        ? null
        : await text.messages.fetch(settings.adminPanelMessageId).catch(() => null);
    if (existing === null) {
      const message = await text.send(payload);
      await this.prisma.tenManSettings.update({
        where: { guildId },
        data: { adminPanelMessageId: message.id },
      });
    } else await existing.edit(payload);
  }

  private async buildSubview(
    guildId: string,
    settings: {
      version: number;
      teamSelectionMode: string;
      mapSelectionMode: string;
      defaultServerLocation: string | null;
      defaultGameProfileKey: string | null;
    },
    moderators: Array<{ discordUserId: string; status: string }>,
    request: AdminPanelViewRequest,
  ): Promise<AdminPanelSubview> {
    if (request.kind === 'CONFIGURE') {
      return {
        kind: 'CONFIGURE',
        draft: request.draft ?? { guildId, ...configurationDraftFromSettings(settings) },
      };
    }
    if (request.kind === 'MODERATORS') return { kind: 'MODERATORS', members: moderators };
    if (request.kind === 'MAPS') {
      const [profile, workshopMaps, activePool] = await Promise.all([
        this.prisma.gameProfile.findUnique({
          where: { key: settings.defaultGameProfileKey ?? 'competitive_5v5' },
          select: { mapAllowlist: true },
        }),
        this.mapPoolService.listWorkshopCatalog(guildId),
        this.mapPoolService.getActiveMapPool(guildId),
      ]);
      if (profile === null) throw new Error('Configured game profile is missing');
      const officialMaps = profile.mapAllowlist.filter((mapName) => mapName.startsWith('de_'));
      const pageCount = Math.max(1, Math.ceil((officialMaps.length + workshopMaps.length) / 25));
      return {
        kind: 'MAPS',
        maps: {
          guildId,
          settingsVersion: settings.version,
          activePool,
          officialMaps,
          workshopMaps,
          page: Math.min(request.page ?? 0, pageCount - 1),
        },
      };
    }
    return { kind: 'MAIN' };
  }
}
