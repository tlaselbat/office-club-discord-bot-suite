import {
  DiscordAPIError,
  RateLimitError,
  type Client,
  type MessageCreateOptions,
  type MessageEditOptions,
  type TextBasedChannel,
  type TextChannel,
} from 'discord.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { scheduleJob } from '../../database/schedule-job.js';
import { PublicError } from '../../errors/public-error.js';
import { cardFingerprint, renderGameServerCard } from './renderer.js';

type Deployment = { id: string; channelId: string; messageId: string | null };

export class GameServerCardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
    private readonly secret: string,
  ) {}

  /** Publish or reconcile one desired server-card deployment in a channel. */
  public async publishDeployment(
    gameServerId: string,
    channel: TextBasedChannel,
  ): Promise<Deployment> {
    const server = await this.prisma.gameServer.findFirst({
      where: { id: gameServerId, enabled: true, public: true },
      include: { snapshot: true, updateThreads: true },
    });
    if (server === null)
      throw new PublicError(
        'GAME_SERVER_CARD_NOT_FOUND',
        'Selected game server is no longer available or is not public.',
      );
    const existing = await this.prisma.gameServerCard.findFirst({
      where: { gameServerId, channelId: channel.id },
      select: { id: true, channelId: true, messageId: true },
    });
    if (existing !== null) {
      // Publishing an already-managed destination is idempotent. Refresh handles
      // a missing or unhealthy desired deployment without duplicating its message.
      await this.refreshCard(existing.id);
      return existing;
    }
    // Persist intent before Discord I/O: a transient failure must not discard the target.
    const created = await this.prisma.gameServerCard.create({
      data: {
        guildId: server.guildId,
        gameServerId: server.id,
        channelId: channel.id,
        messageId: null,
        state: 'CREATING',
        lastSuccessfulPollAt: server.snapshot?.lastSuccessfulAt ?? null,
      },
      select: { id: true, channelId: true, messageId: true },
    });
    await this.reconcileDeployment(created.id, channel);
    return created;
  }

  /** @deprecated Use publishDeployment. Retained for existing callers. */
  public async createCard(gameServerId: string, channel: TextBasedChannel): Promise<void> {
    await this.publishDeployment(gameServerId, channel);
  }

  public async reconcileDeployment(cardId: string, target?: TextBasedChannel): Promise<void> {
    const card = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      include: { gameServer: { include: { snapshot: true, updateThreads: true } } },
    });
    if (card === null) return;
    if (!card.gameServer.enabled || !card.gameServer.public) {
      await this.markDeployment(card.id, 'ERROR', 'Server is not eligible for public display.');
      return;
    }
    const channel = target ?? (await this.discord.channels.fetch(card.channelId).catch(() => null));
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      await this.markDeployment(card.id, 'MISSING', 'Display channel is unavailable.');
      return;
    }
    try {
      const message = await (channel as TextChannel).send(
        renderGameServerCard(card.gameServer, this.secret) as unknown as MessageCreateOptions,
      );
      await this.prisma.gameServerCard.update({
        where: { id: card.id },
        data: {
          messageId: message.id,
          state: 'HEALTHY',
          lastReconciledAt: new Date(),
          lastError: null,
          lastKnownState: cardFingerprint(card.gameServer) as unknown as Prisma.InputJsonValue,
          lastSuccessfulPollAt: card.gameServer.snapshot?.lastSuccessfulAt ?? null,
        },
      });
    } catch (error: unknown) {
      await this.markDeployment(card.id, 'ERROR', errorMessage(error));
      throw error;
    }
  }

  public async refreshCard(cardId: string): Promise<{ rescheduleAt: Date } | undefined> {
    const card = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      include: { gameServer: { include: { snapshot: true, updateThreads: true } } },
    });
    if (card === null || !card.gameServer.enabled || !card.gameServer.public) return undefined;
    const fingerprint = cardFingerprint(card.gameServer);
    if (card.messageId === null || card.state !== 'HEALTHY') {
      await this.reconcileDeployment(card.id);
      return undefined;
    }
    if (card.lastKnownState !== null && fingerprintsEqual(card.lastKnownState, fingerprint))
      return undefined;
    const channel = await this.discord.channels.fetch(card.channelId).catch(() => null);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      await this.markDeployment(card.id, 'MISSING', 'Display channel is unavailable.');
      return undefined;
    }
    const message = await (channel as TextChannel).messages
      .fetch(card.messageId)
      .catch((error: unknown) => {
        if (isUnknownMessageError(error)) return null;
        throw error instanceof Error
          ? error
          : new Error('Could not fetch managed Discord message.');
      });
    if (message === null) {
      await this.prisma.gameServerCard.update({
        where: { id: card.id },
        data: {
          messageId: null,
          state: 'MISSING',
          lastError: 'Managed Discord message is missing.',
        },
      });
      await this.reconcileDeployment(card.id, channel);
      return undefined;
    }
    try {
      await message.edit(
        renderGameServerCard(card.gameServer, this.secret) as unknown as MessageEditOptions,
      );
    } catch (error: unknown) {
      const rescheduleAt = retryAt(error);
      if (rescheduleAt !== null) return { rescheduleAt };
      await this.markDeployment(card.id, 'ERROR', errorMessage(error));
      throw error;
    }
    await this.prisma.gameServerCard.update({
      where: { id: card.id },
      data: {
        state: 'HEALTHY',
        lastReconciledAt: new Date(),
        lastError: null,
        lastKnownState: fingerprint as unknown as Prisma.InputJsonValue,
        lastSuccessfulPollAt: card.gameServer.snapshot?.lastSuccessfulAt ?? null,
      },
    });
    return undefined;
  }

  public async removeDeployment(cardId: string): Promise<void> {
    const card = await this.prisma.gameServerCard.findUnique({ where: { id: cardId } });
    if (card === null) return;
    if (card.messageId !== null) {
      const channel = await this.discord.channels.fetch(card.channelId).catch(() => null);
      if (channel !== null && channel.isTextBased() && !channel.isDMBased()) {
        const message = await (channel as TextChannel).messages
          .fetch(card.messageId)
          .catch((error: unknown) => (isUnknownMessageError(error) ? null : null));
        // Snowflakes are never reused; bot authorship still gates destructive deletion.
        if (message !== null && message.author.id === this.discord.user?.id) await message.delete();
      }
    }
    await this.prisma.gameServerCard.delete({ where: { id: card.id } });
  }

  public async moveDeployment(cardId: string, destination: TextBasedChannel): Promise<Deployment> {
    const source = await this.prisma.gameServerCard.findUnique({ where: { id: cardId } });
    if (source === null)
      throw new PublicError('GAME_SERVER_CARD_NOT_FOUND', 'Display deployment not found.');
    if (source.channelId === destination.id) return source;
    const created = await this.publishDeployment(source.gameServerId, destination);
    await this.removeDeployment(source.id);
    return created;
  }

  public async removeDeploymentsForGameServer(gameServerId: string): Promise<void> {
    const cards = await this.prisma.gameServerCard.findMany({
      where: { gameServerId },
      select: { id: true },
    });
    for (const card of cards) await this.removeDeployment(card.id);
  }

  public async refreshCardsForGameServer(gameServerId: string): Promise<void> {
    const cards = await this.prisma.gameServerCard.findMany({
      where: { gameServerId },
      select: { id: true },
    });
    for (const card of cards) await scheduleGameServerCardRefresh(this.prisma, card.id);
  }

  private async markDeployment(
    cardId: string,
    state: 'MISSING' | 'ERROR',
    lastError: string,
  ): Promise<void> {
    await this.prisma.gameServerCard.update({
      where: { id: cardId },
      data: { state, lastError, lastReconciledAt: new Date() },
    });
  }
}

export async function scheduleGameServerCardRefresh(
  prisma: Pick<PrismaClient, 'job'>,
  cardId: string,
  runAt = new Date(),
  revision?: string,
): Promise<void> {
  await scheduleJob(prisma, {
    type: 'GAME_SERVER_CARD_REFRESH',
    idempotencyKey: `game-server:card:${cardId}${revision === undefined ? '' : `:${revision}`}`,
    payload: { cardId },
    runAt,
  });
}

function fingerprintsEqual(stored: unknown, current: ReturnType<typeof cardFingerprint>): boolean {
  try {
    return JSON.stringify(stored) === JSON.stringify(current);
  } catch {
    return false;
  }
}
function isUnknownMessageError(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 10_008;
}
function retryAt(error: unknown): Date | null {
  if (error instanceof RateLimitError)
    return new Date(
      Date.now() +
        (typeof (error as { retryAfter?: number }).retryAfter === 'number'
          ? (error as { retryAfter: number }).retryAfter
          : 5_000),
    );
  if (error instanceof DiscordAPIError && error.status === 429) {
    const raw = error.rawError as unknown as Record<string, unknown> | null;
    return new Date(
      Date.now() +
        (raw !== null && typeof raw.retry_after === 'number' ? raw.retry_after * 1_000 : 5_000),
    );
  }
  return null;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : 'Unknown Discord error';
}
