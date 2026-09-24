import type { Client, TextBasedChannel, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { buildLockedQueueControls, buildQueueControls } from '../bot/queue-components.js';

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
    const playersNeeded = Math.max(0, size - queue.entries.length);
    const names =
      queue.entries
        .map((entry, index) => `${String(index + 1)}. ${entry.displayNameSnapshot}`)
        .join('\n') || 'No players queued.';
    const openDescription = [
      'Join a private 5v5 CS2 match.',
      '',
      'When 10 players are queued, everyone gets a ready check before teams and the map are selected.',
      '',
      `**Queue: ${String(queue.entries.length)} / ${String(size)}**`,
      playersNeeded === 0
        ? 'Queue is full — ready check will start when the last player joins.'
        : `${String(playersNeeded)} more player${playersNeeded === 1 ? '' : 's'} needed.`,
      '',
      '**What happens next?**',
      'Queue → Ready Check → Teams → Map → Server → Match',
      '',
      locked ? '' : names,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      embeds: [
        {
          title: 'CS2 10man',
          description: locked
            ? 'A match is currently being formed or played. The queue will reopen when it finishes.'
            : openDescription,
          fields: locked
            ? [
                {
                  name: 'Status',
                  value: 'Temporarily unavailable',
                },
              ]
            : [
                {
                  name: 'Status',
                  value: `Waiting for ${String(playersNeeded)} player${playersNeeded === 1 ? '' : 's'}`,
                },
              ],
        },
      ],
      components: locked
        ? buildLockedQueueControls(queue.guildId, queue.version, this.secret)
        : buildQueueControls(queue.guildId, queue.version, this.secret),
    };
  }
}
