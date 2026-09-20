import type { Client, TextBasedChannel, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { buildQueueControls } from '../bot/queue-components.js';

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
    const payload = this.render(queue, settings.queueSize);
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

  private render(
    queue: {
      guildId: string;
      status: string;
      version: number;
      entries: { displayNameSnapshot: string }[];
    },
    size: number,
  ) {
    const locked = queue.status !== 'OPEN';
    const names =
      queue.entries
        .map((entry, index) => `${String(index + 1)}. ${entry.displayNameSnapshot}`)
        .join('\n') || 'No players queued.';
    return {
      embeds: [
        {
          title: '10MAN QUEUE',
          description: locked
            ? 'A match is currently being formed or played. Queue entries are paused.'
            : `Players: ${String(queue.entries.length)} / ${String(size)}\n\n${names}`,
          fields: [
            {
              name: 'Status',
              value: locked
                ? 'Temporarily unavailable'
                : `Waiting for ${String(Math.max(0, size - queue.entries.length))} players`,
            },
          ],
        },
      ],
      components: locked ? [] : buildQueueControls(queue.guildId, queue.version, this.secret),
    };
  }
}
