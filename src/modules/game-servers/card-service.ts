import {
  DiscordAPIError,
  RateLimitError,
  type Client,
  type TextBasedChannel,
  type TextChannel,
} from 'discord.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { scheduleJob } from '../../database/schedule-job.js';
import { PublicError } from '../../errors/public-error.js';
import { cardFingerprint, renderGameServerCard } from './renderer.js';

export class GameServerCardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  public async createCard(gameServerId: string, channel: TextBasedChannel): Promise<void> {
    const existing = await this.prisma.gameServerCard.findUnique({
      where: { gameServerId },
      select: { id: true },
    });
    if (existing !== null) {
      throw new PublicError(
        'GAME_SERVER_CARD_EXISTS',
        'A status card for this server has already been added.',
      );
    }

    const server = await this.prisma.gameServer.findFirst({
      where: { id: gameServerId, enabled: true, public: true },
      include: { snapshot: true },
    });
    if (server === null) {
      throw new PublicError(
        'GAME_SERVER_CARD_NOT_FOUND',
        'Selected game server is no longer available or is not public.',
      );
    }

    const payload = renderGameServerCard(server);
    const text = channel as TextChannel;
    const message = await text.send(payload);

    await this.prisma.gameServerCard.create({
      data: {
        guildId: server.guildId,
        gameServerId: server.id,
        channelId: channel.id,
        messageId: message.id,
        lastKnownState: cardFingerprint(server) as unknown as Prisma.InputJsonValue,
        lastSuccessfulPollAt: server.snapshot?.lastSuccessfulAt ?? null,
      },
    });
  }

  public async refreshCard(cardId: string): Promise<{ rescheduleAt: Date } | undefined> {
    const card = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      include: { gameServer: { include: { snapshot: true } } },
    });
    if (card === null || !card.gameServer.enabled) return undefined;

    const fingerprint = cardFingerprint(card.gameServer);
    if (card.lastKnownState !== null && fingerprintsEqual(card.lastKnownState, fingerprint)) {
      return undefined;
    }

    const channel = await this.discord.channels.fetch(card.channelId).catch(() => null);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      await this.prisma.gameServerCard.delete({ where: { id: card.id } }).catch(() => null);
      return undefined;
    }

    const text = channel as TextChannel;
    const message = await text.messages.fetch(card.messageId).catch((error: unknown) => {
      if (isUnknownMessageError(error)) return null;
      throw error;
    });
    if (message === null) {
      await this.prisma.gameServerCard.delete({ where: { id: card.id } }).catch(() => null);
      return undefined;
    }

    try {
      await message.edit(renderGameServerCard(card.gameServer));
    } catch (error: unknown) {
      if (error instanceof RateLimitError) {
        const delayMs =
          typeof (error as { retryAfter?: number }).retryAfter === 'number'
            ? (error as { retryAfter: number }).retryAfter
            : 5_000;
        return { rescheduleAt: new Date(Date.now() + delayMs) };
      }
      if (error instanceof DiscordAPIError && error.status === 429) {
        const rawError = error.rawError as unknown as Record<string, unknown> | null;
        const retryAfterSeconds =
          rawError !== null && typeof rawError.retry_after === 'number'
            ? rawError.retry_after
            : null;
        const retryAfterMs = retryAfterSeconds === null ? 5_000 : retryAfterSeconds * 1_000;
        return { rescheduleAt: new Date(Date.now() + retryAfterMs) };
      }
      throw error;
    }
    await this.prisma.gameServerCard.update({
      where: { id: card.id },
      data: {
        lastKnownState: fingerprint as unknown as Prisma.InputJsonValue,
        lastSuccessfulPollAt: card.gameServer.snapshot?.lastSuccessfulAt ?? null,
      },
    });
    return undefined;
  }

  public async refreshCardsForGameServer(gameServerId: string): Promise<void> {
    const cards = await this.prisma.gameServerCard.findMany({
      where: { gameServerId },
      select: { id: true },
    });
    for (const card of cards) await scheduleGameServerCardRefresh(this.prisma, card.id);
  }
}

export async function scheduleGameServerCardRefresh(
  prisma: Pick<PrismaClient, 'job'>,
  cardId: string,
  runAt = new Date(),
): Promise<void> {
  await scheduleJob(prisma, {
    type: 'GAME_SERVER_CARD_REFRESH',
    idempotencyKey: `game-server:card:${cardId}`,
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
