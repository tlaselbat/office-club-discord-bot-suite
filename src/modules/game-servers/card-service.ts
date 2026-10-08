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
import { withDatabaseAdvisoryLock } from '../../database/prisma.js';
import { scheduleJob } from '../../database/schedule-job.js';
import { PublicError } from '../../errors/public-error.js';
import { cardFingerprint, renderGameServerCard } from './renderer.js';

type Deployment = { id: string; channelId: string; messageId: string | null };
type GameServerLock = <T>(key: string, operation: () => Promise<T>) => Promise<T>;

export class GameServerCardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
    private readonly secret: string,
    lock?: GameServerLock,
  ) {
    this.gameServerLock =
      lock ?? ((key, operation) => withDatabaseAdvisoryLock(this.prisma, key, operation));
  }

  private readonly gameServerLock: GameServerLock;

  /** Publish or reconcile one desired server-card deployment in a channel. */
  public async publishDeployment(
    gameServerId: string,
    channel: TextBasedChannel,
  ): Promise<Deployment> {
    return this.withGameServerLock(gameServerId, () =>
      this.publishDeploymentUnlocked(gameServerId, channel),
    );
  }

  private async publishDeploymentUnlocked(
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
    if (!(await this.isModuleEnabled(server.guildId)))
      throw new PublicError(
        'GAME_SERVER_MODULE_DISABLED',
        'Game Server cards are disabled for this server.',
      );
    const existing = await this.prisma.gameServerCard.findFirst({
      where: { gameServerId, channelId: channel.id },
      select: { id: true, channelId: true, messageId: true },
    });
    if (existing !== null) {
      await this.reconcileDeploymentUnlocked(existing.id, channel);
      return this.persistedDeployment(existing);
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
    await this.reconcileDeploymentUnlocked(created.id, channel);
    return this.persistedDeployment(created);
  }

  /** @deprecated Use publishDeployment. Retained for existing callers. */
  public async createCard(gameServerId: string, channel: TextBasedChannel): Promise<void> {
    await this.publishDeployment(gameServerId, channel);
  }

  public async reconcileDeployment(cardId: string, target?: TextBasedChannel): Promise<void> {
    const card = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      select: { gameServerId: true },
    });
    if (card === null) return;
    await this.withGameServerLock(card.gameServerId, () =>
      this.reconcileDeploymentUnlocked(cardId, target),
    );
  }

  private async reconcileDeploymentUnlocked(
    cardId: string,
    target?: TextBasedChannel,
  ): Promise<void> {
    const card = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      include: { gameServer: { include: { snapshot: true, updateThreads: true } } },
    });
    if (card === null) return;
    if (!card.gameServer.public) {
      await this.removeDeploymentUnlocked(card);
      return;
    }
    if (!(await this.isModuleEnabled(card.guildId))) return;
    if (!card.gameServer.enabled) return;
    let channel: TextBasedChannel | null;
    try {
      channel =
        target ?? ((await this.discord.channels.fetch(card.channelId)) as TextBasedChannel | null);
    } catch (error: unknown) {
      await this.markDeployment(
        card.id,
        'ERROR',
        `Could not fetch display channel: ${errorMessage(error)}`,
      );
      throw error;
    }
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      await this.markDeployment(card.id, 'MISSING', 'Display channel is unavailable.');
      return;
    }
    try {
      if (card.messageId !== null) {
        const known = await (channel as TextChannel).messages
          .fetch(card.messageId)
          .catch((error: unknown) => {
            if (isUnknownMessageError(error)) return null;
            throw error instanceof Error
              ? error
              : new Error('Could not fetch managed Discord message.');
          });
        if (known !== null) {
          await known.edit(
            renderGameServerCard(card.gameServer, this.secret) as unknown as MessageEditOptions,
          );
          await this.prisma.gameServerCard.update({
            where: { id: card.id },
            data: {
              state: 'HEALTHY',
              lastReconciledAt: new Date(),
              lastError: null,
              lastKnownState: cardFingerprint(card.gameServer) as unknown as Prisma.InputJsonValue,
              lastSuccessfulPollAt: card.gameServer.snapshot?.lastSuccessfulAt ?? null,
            },
          });
          return;
        }
        await this.prisma.gameServerCard.update({
          where: { id: card.id },
          data: {
            messageId: null,
            state: 'MISSING',
            lastError: 'Managed Discord message is missing.',
          },
        });
      }
      const message = await (channel as TextChannel).send(
        renderGameServerCard(card.gameServer, this.secret) as unknown as MessageCreateOptions,
      );
      try {
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
      } catch (persistenceError: unknown) {
        if (message.author.id === this.discord.user?.id)
          await message.delete().catch(() => undefined);
        throw persistenceError;
      }
    } catch (error: unknown) {
      await this.markDeployment(card.id, 'ERROR', errorMessage(error));
      throw error;
    }
  }

  public async refreshCard(cardId: string): Promise<{ rescheduleAt: Date } | undefined> {
    const identifying = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      select: { gameServerId: true },
    });
    if (identifying === null) return undefined;
    return this.withGameServerLock(identifying.gameServerId, () =>
      this.refreshCardUnlocked(cardId),
    );
  }

  private async refreshCardUnlocked(cardId: string): Promise<{ rescheduleAt: Date } | undefined> {
    const card = await this.prisma.gameServerCard.findUnique({
      where: { id: cardId },
      include: { gameServer: { include: { snapshot: true, updateThreads: true } } },
    });
    if (card === null) return undefined;
    if (!card.gameServer.public) {
      await this.removeDeploymentUnlocked(card);
      return undefined;
    }
    if (!(await this.isModuleEnabled(card.guildId))) return undefined;
    if (!card.gameServer.enabled) return undefined;
    const fingerprint = cardFingerprint(card.gameServer);
    if (card.messageId === null || card.state !== 'HEALTHY') {
      await this.reconcileDeploymentUnlocked(card.id);
      return undefined;
    }
    if (card.lastKnownState !== null && fingerprintsEqual(card.lastKnownState, fingerprint))
      return undefined;
    let channel: TextBasedChannel | null;
    try {
      channel = (await this.discord.channels.fetch(card.channelId)) as TextBasedChannel | null;
    } catch (error: unknown) {
      const rescheduleAt = retryAt(error);
      if (rescheduleAt !== null) return { rescheduleAt };
      await this.markDeployment(
        card.id,
        'ERROR',
        `Could not fetch display channel: ${errorMessage(error)}`,
      );
      throw error;
    }
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      await this.markDeployment(card.id, 'MISSING', 'Display channel is unavailable.');
      return undefined;
    }
    let message;
    try {
      message = await (channel as TextChannel).messages.fetch(card.messageId);
    } catch (error: unknown) {
      if (isUnknownMessageError(error)) message = null;
      else {
        const rescheduleAt = retryAt(error);
        if (rescheduleAt !== null) return { rescheduleAt };
        await this.markDeployment(
          card.id,
          'ERROR',
          `Could not fetch managed Discord message: ${errorMessage(error)}`,
        );
        throw error;
      }
    }
    if (message === null) {
      await this.prisma.gameServerCard.update({
        where: { id: card.id },
        data: {
          messageId: null,
          state: 'MISSING',
          lastError: 'Managed Discord message is missing.',
        },
      });
      await this.reconcileDeploymentUnlocked(card.id, channel);
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
    await this.withGameServerLock(card.gameServerId, async () => {
      const current = await this.prisma.gameServerCard.findUnique({ where: { id: cardId } });
      if (current !== null) await this.removeDeploymentUnlocked(current);
    });
  }

  private async removeDeploymentUnlocked(card: {
    id: string;
    gameServerId: string;
    channelId: string;
    messageId: string | null;
  }): Promise<void> {
    if (card.messageId !== null) {
      let channel: TextBasedChannel | null;
      try {
        channel = (await this.discord.channels.fetch(card.channelId)) as TextBasedChannel | null;
      } catch (error: unknown) {
        if (isUnknownChannelError(error)) {
          await this.prisma.gameServerCard.delete({ where: { id: card.id } });
          return;
        }
        await this.markDeployment(
          card.id,
          'ERROR',
          `Could not fetch display channel for removal: ${errorMessage(error)}`,
        );
        throw error;
      }
      if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
        await this.markDeployment(
          card.id,
          'ERROR',
          'Display channel is unavailable; deployment was retained.',
        );
        throw new Error('Display channel is unavailable; deployment was retained.');
      }
      let message;
      try {
        message = await (channel as TextChannel).messages.fetch(card.messageId);
      } catch (error: unknown) {
        if (!isUnknownMessageError(error)) {
          await this.markDeployment(
            card.id,
            'ERROR',
            `Could not fetch managed Discord message for removal: ${errorMessage(error)}`,
          );
          throw error;
        }
        message = null;
      }
      // Snowflakes are never reused; bot authorship still gates destructive deletion.
      if (message !== null && message.author.id !== this.discord.user?.id) {
        const error = new Error(
          'Managed Discord message is no longer authored by this bot; deployment was retained.',
        );
        await this.markDeployment(card.id, 'ERROR', error.message);
        throw error;
      }
      if (message !== null) {
        try {
          await message.delete();
        } catch (error: unknown) {
          if (!isUnknownMessageError(error)) {
            await this.markDeployment(
              card.id,
              'ERROR',
              `Could not delete managed Discord message: ${errorMessage(error)}`,
            );
            throw error;
          }
        }
      }
    }
    await this.prisma.gameServerCard.delete({ where: { id: card.id } });
  }

  public async moveDeployment(cardId: string, destination: TextBasedChannel): Promise<Deployment> {
    const source = await this.prisma.gameServerCard.findUnique({ where: { id: cardId } });
    if (source === null)
      throw new PublicError('GAME_SERVER_CARD_NOT_FOUND', 'Display deployment not found.');
    if (source.channelId === destination.id) return source;
    return this.withGameServerLock(source.gameServerId, async () => {
      const current = await this.prisma.gameServerCard.findUnique({ where: { id: cardId } });
      if (current === null)
        throw new PublicError('GAME_SERVER_CARD_NOT_FOUND', 'Display deployment not found.');
      if (current.channelId === destination.id) return current;
      const created = await this.publishDeploymentUnlocked(current.gameServerId, destination);
      await this.removeDeploymentUnlocked(current);
      return created;
    });
  }

  public async removeDeploymentsForGameServer(
    gameServerId: string,
    afterRemoval?: () => Promise<void>,
  ): Promise<void> {
    await this.withGameServerLock(gameServerId, async () => {
      const cards = await this.prisma.gameServerCard.findMany({ where: { gameServerId } });
      for (const card of cards) await this.removeDeploymentUnlocked(card);
      await afterRemoval?.();
    });
  }

  public async refreshCardsForGameServer(gameServerId: string): Promise<void> {
    await this.withGameServerLock(gameServerId, async () => {
      const cards = await this.prisma.gameServerCard.findMany({
        where: { gameServerId },
        select: { id: true },
      });
      for (const card of cards) await scheduleGameServerCardRefresh(this.prisma, card.id);
    });
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

  private async persistedDeployment(fallback: Deployment): Promise<Deployment> {
    return (
      (await this.prisma.gameServerCard.findUnique({
        where: { id: fallback.id },
        select: { id: true, channelId: true, messageId: true },
      })) ?? fallback
    );
  }

  private async isModuleEnabled(guildId: string): Promise<boolean> {
    const settings = await this.prisma.gameServerSettings.findUnique({
      where: { guildId },
      select: { enabled: true },
    });
    return settings?.enabled !== false;
  }

  private async withGameServerLock<T>(
    gameServerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.gameServerLock(`game-server-card:${gameServerId}`, operation);
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
function isUnknownChannelError(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 10_003;
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
