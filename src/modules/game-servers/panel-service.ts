import type { Client, TextBasedChannel, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { renderAddGameServersPanel } from './renderer.js';

export class GameServerPanelService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
    private readonly secret: string,
  ) {}

  public async reconcile(guildId: string, channel?: TextBasedChannel): Promise<void> {
    const settings = await this.prisma.gameServerSettings.findUnique({ where: { guildId } });
    if (settings === null || !settings.enabled) return;
    const target =
      channel ??
      (settings.panelChannelId === null
        ? null
        : await this.discord.channels.fetch(settings.panelChannelId).catch(() => null));
    if (target === null || !target.isTextBased() || target.isDMBased()) return;
    const servers = await this.prisma.gameServer.findMany({
      where: { guildId, enabled: true, public: true },
      include: { snapshot: true, cards: { select: { id: true } } },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    const payload = renderAddGameServersPanel(
      servers.map((server) => ({ ...server, hasCard: server.cards.length > 0 })),
      this.secret,
    );
    const text = target as TextChannel;
    const existing =
      settings.panelMessageId === null
        ? null
        : await text.messages.fetch(settings.panelMessageId).catch(() => null);
    if (existing === null) {
      const message = await text.send(payload);
      await this.prisma.gameServerSettings.update({
        where: { guildId },
        data: { panelChannelId: text.id, panelMessageId: message.id },
      });
    } else await existing.edit(payload);
  }
}
