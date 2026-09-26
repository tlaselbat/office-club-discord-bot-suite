import type { Client, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { renderAdminPanel } from '../bot/admin-panel-renderer.js';

/** Renders the singleton staff control panel from persisted state. */
export class AdminPanelService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly secret: string,
  ) {}

  public async reconcile(guildId: string): Promise<void> {
    const [settings, queue, moderators] = await Promise.all([
      this.prisma.tenManSettings.findUnique({ where: { guildId } }),
      this.prisma.tenManQueue.findUnique({ where: { guildId }, include: { entries: true } }),
      this.prisma.matchModerator.count({ where: { guildId, status: 'ACTIVE' } }),
    ]);
    if (settings === null || settings.adminChannelId === null) return;
    const channel = await this.client.channels.fetch(settings.adminChannelId).catch(() => null);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) return;
    const text = channel as TextChannel;
    const payload = renderAdminPanel(
      {
        guildId,
        settingsVersion: settings.version,
        queueVersion: queue?.version ?? 0,
        enabled: settings.enabled,
        queueStatus: queue?.status ?? 'NOT_STARTED',
        queueCount: queue?.entries.length ?? 0,
        queueCapacity: settings.queueSize,
        profile: settings.defaultGameProfileKey,
        location: settings.defaultServerLocation,
        matchModeratorCount: moderators,
      },
      this.secret,
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
}
