import type { Client, TextBasedChannel, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { renderQueuePanel } from '../bot/queue-panel-renderer.js';

/** Renders the singleton guild queue without inferring state from Discord. */
export class QueuePanelService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly secret: string,
  ) {}

  public async reconcile(guildId: string, channel?: TextBasedChannel): Promise<void> {
    const queue = await this.prisma.tenManQueue.findUnique({
      where: { guildId },
      include: { entries: { orderBy: { joinedAt: 'asc' } } },
    });
    const settings = await this.prisma.tenManSettings.findUnique({ where: { guildId } });
    if (queue === null || settings === null) return;
    const target =
      channel ??
      (queue.panelChannelId === null
        ? null
        : await this.client.channels.fetch(queue.panelChannelId).catch(() => null));
    if (target === null || !target.isTextBased()) return;
    const activeMatch =
      queue.status === 'OPEN'
        ? null
        : await this.prisma.match.findFirst({
            where: { guildId, guildSlotActive: true },
            select: { id: true, state: true, version: true, phaseGeneration: true },
          });
    const payload = renderQueuePanel(
      {
        guildId,
        version: queue.version,
        queueOpen: queue.status === 'OPEN',
        queueEverOpened: queue.enrollmentOpenedAt !== null,
        queueCount: queue.entries.length,
        queueCapacity: settings.queueSize,
        playerDisplayNames: queue.entries.map((entry) => entry.displayNameSnapshot),
        activeMatchState: activeMatch?.state ?? null,
        ...(activeMatch?.state === 'READY_CHECK'
          ? {
              readyCheck: {
                matchId: activeMatch.id,
                version: activeMatch.version,
                phaseGeneration: activeMatch.phaseGeneration,
              },
            }
          : {}),
      },
      this.secret,
    );
    const text = target as TextChannel;
    const existing =
      queue.panelMessageId === null
        ? null
        : await text.messages.fetch(queue.panelMessageId).catch(() => null);
    if (existing === null) {
      const message = await text.send(payload);
      await this.prisma.tenManQueue.update({
        where: { guildId },
        data: { panelChannelId: text.id, panelMessageId: message.id },
      });
    } else await existing.edit(payload);
  }
}
