import {
  ChannelType,
  DiscordAPIError,
  MessageType,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type Client,
  type Message,
  type PartialMessage,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type {
  Prisma,
  PrismaClient,
  GameServerUpdateThread,
} from '../../generated/prisma/client.js';
import { scheduleJob } from '../../database/schedule-job.js';
import { scheduleGameServerCardRefresh } from './card-service.js';
import type { UpdateThreadView } from './renderer.js';

const THREAD_TYPES = ['ANNOUNCEMENTS', 'CHANGELOG'] as const;
export const NEW_WINDOW_MS = 48 * 60 * 60 * 1_000;
export const UPDATE_RECONCILE_MS = 15 * 60 * 1_000;
type ManagedType = (typeof THREAD_TYPES)[number];
type DiscordMessage = Message | PartialMessage;
type Database = Prisma.TransactionClient;
export interface UpdateExpiryPayload {
  gameServerId: string;
  threadType: ManagedType;
  expectedExpiresAt: string;
}

export class GameServerUpdateThreadService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  public async ensureThreads(gameServerId: string): Promise<void> {
    const results = await Promise.allSettled(
      THREAD_TYPES.map((type) => this.ensureThread(gameServerId, type)),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  public async ensureThread(gameServerId: string, type: ManagedType): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Cross-process serialization plus deterministic-name recovery closes the
        // Discord-success/DB-rollback window without blindly creating duplicates.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`game-update:${gameServerId}:${type}`}, 0))`;
        const server = await tx.gameServer.findUnique({
          where: { id: gameServerId },
          include: { cards: true },
        });
        if (server === null || !server.enabled || !server.public) return;
        const settings = await tx.gameServerSettings.findUnique({
          where: { guildId: server.guildId },
        });
        if (settings?.enabled === false) return;
        const card = server.cards[0];
        if (card === undefined) return;
        const stored = await tx.gameServerUpdateThread.findUnique({
          where: { gameServerId_type: { gameServerId, type } },
        });
        if (stored !== null) {
          const thread = await this.fetchThread(stored.threadId);
          if (thread !== null) {
            if (thread.guildId !== server.guildId || thread.parentId !== stored.parentChannelId)
              throw new Error('Managed update thread does not match its stored guild/parent');
            return; // Archived is valid; reconciliation never unarchives.
          }
        }
        const parent = await this.fetchParent(
          stored?.parentChannelId ?? card.channelId,
          server.guildId,
        );
        const recovered = await this.findOwnedThread(parent, managedThreadSuffix(server.id, type));
        const thread =
          recovered ??
          (await parent.threads.create({
            name: managedThreadName(server.displayName, server.id, type),
            type: ChannelType.PublicThread,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            reason: `Managed game-server ${type.toLowerCase()}`,
          }));
        await tx.gameServerUpdateThread.upsert({
          where: { gameServerId_type: { gameServerId, type } },
          create: {
            guildId: server.guildId,
            gameServerId,
            type,
            threadId: thread.id,
            parentChannelId: parent.id,
          },
          update: { threadId: thread.id, parentChannelId: parent.id, ...emptyPreview() },
        });
        if (recovered === null)
          await thread.send({
            content:
              type === 'ANNOUNCEMENTS'
                ? '# Announcements\n\nImportant updates for this server will be posted here.'
                : '# Changelog\n\nServer configuration, plugin, map, and gameplay changes will be recorded here.',
            allowedMentions: { parse: [] },
          });
        await this.refreshCards(tx, gameServerId, `thread:${thread.id}`);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  public async getThreadViews(gameServerId: string): Promise<UpdateThreadView[]> {
    return this.prisma.gameServerUpdateThread.findMany({
      where: { gameServerId },
      select: {
        type: true,
        threadId: true,
        latestMessageText: true,
        latestMessageAt: true,
        notificationExpiresAt: true,
      },
    });
  }

  public async recordMessage(input: DiscordMessage): Promise<void> {
    const managed = await this.managedMessage(input);
    if (managed === null) return;
    const message = input.partial ? await input.fetch() : input;
    if (!(await this.isOfficial(message))) return;
    if (managed.latestMessageId !== null && BigInt(message.id) <= BigInt(managed.latestMessageId))
      return;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameServerUpdateThread.updateMany({
        where: {
          id: managed.id,
          threadId: message.channelId,
          latestMessageId: managed.latestMessageId,
        },
        data: previewData(message),
      });
      if (updated.count === 0) return;
      await this.scheduleExpiry(tx, managed, message.createdAt);
      await this.refreshCards(tx, managed.gameServerId, `post:${message.id}`);
    });
    // Converge concurrent deliveries on the largest snowflake, including ties in timestamp.
    const current = await this.prisma.gameServerUpdateThread.findUnique({
      where: { id: managed.id },
    });
    if (
      current?.threadId === message.channelId &&
      (current.latestMessageId === null || BigInt(current.latestMessageId) < BigInt(message.id))
    )
      await this.recordMessage(message);
  }

  public async recordMessageEdit(input: DiscordMessage): Promise<void> {
    const managed = await this.managedMessage(input);
    if (managed === null || managed.latestMessageId !== input.id) return;
    const message = input.partial ? await input.fetch() : input;
    if (!(await this.isOfficial(message))) return;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameServerUpdateThread.updateMany({
        where: { id: managed.id, threadId: message.channelId, latestMessageId: message.id },
        data: { latestMessageText: normalizeUpdatePreview(message) },
      });
      if (updated.count > 0)
        await this.refreshCards(
          tx,
          managed.gameServerId,
          `edit:${message.id}:${String(message.editedTimestamp ?? Date.now())}`,
        );
    });
  }

  public async handleMessageDelete(message: DiscordMessage): Promise<void> {
    const managed = await this.managedMessage(message);
    if (managed === null || managed.latestMessageId !== message.id) return;
    await this.syncHistory(managed, new Set([message.id]));
  }

  public async handleMessagesDelete(threadId: string, deletedIds: Set<string>): Promise<void> {
    const managed = await this.prisma.gameServerUpdateThread.findUnique({ where: { threadId } });
    if (
      managed?.latestMessageId !== null &&
      managed?.latestMessageId !== undefined &&
      deletedIds.has(managed.latestMessageId)
    )
      await this.syncHistory(managed, deletedIds);
  }

  public async unarchiveForPublish(
    gameServerId: string,
    type: ManagedType,
  ): Promise<ThreadChannel> {
    await this.ensureThread(gameServerId, type);
    const managed = await this.prisma.gameServerUpdateThread.findUniqueOrThrow({
      where: { gameServerId_type: { gameServerId, type } },
    });
    const thread = await this.fetchThread(managed.threadId);
    if (thread === null) throw new Error('Managed update thread unavailable after reconciliation');
    return thread.archived ? thread.setArchived(false) : thread;
  }

  public async reconcile(gameServerId: string): Promise<{ rescheduleAt: Date } | undefined> {
    const server = await this.prisma.gameServer.findUnique({
      where: { id: gameServerId },
      include: { cards: true },
    });
    if (server === null || !server.enabled || !server.public || server.cards.length === 0)
      return undefined;
    const settings = await this.prisma.gameServerSettings.findUnique({
      where: { guildId: server.guildId },
    });
    if (settings?.enabled === false) return undefined;
    await this.ensureThreads(gameServerId);
    const threads = await this.prisma.gameServerUpdateThread.findMany({ where: { gameServerId } });
    for (const thread of threads) await this.syncHistory(thread);
    for (const card of server.cards) await scheduleGameServerCardRefresh(this.prisma, card.id);
    return { rescheduleAt: new Date(Date.now() + UPDATE_RECONCILE_MS) };
  }

  public async handleThreadDelete(threadId: string): Promise<void> {
    const managed = await this.prisma.gameServerUpdateThread.findUnique({ where: { threadId } });
    if (managed !== null)
      await scheduleGameServerUpdateReconcile(this.prisma, managed.gameServerId);
  }

  public async expireNotification(
    payload: UpdateExpiryPayload,
  ): Promise<{ rescheduleAt: Date } | undefined> {
    const expected = new Date(payload.expectedExpiresAt);
    if (!Number.isFinite(expected.getTime())) throw new Error('Invalid update expiry timestamp');
    const thread = await this.prisma.gameServerUpdateThread.findUnique({
      where: {
        gameServerId_type: { gameServerId: payload.gameServerId, type: payload.threadType },
      },
    });
    if (thread === null || thread.notificationExpiresAt?.getTime() !== expected.getTime())
      return undefined;
    if (expected.getTime() > Date.now()) return { rescheduleAt: expected };
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameServerUpdateThread.updateMany({
        where: { id: thread.id, notificationExpiresAt: expected },
        data: { notificationStartedAt: null, notificationExpiresAt: null },
      });
      if (updated.count > 0)
        await this.refreshCards(
          tx,
          thread.gameServerId,
          `expired:${thread.id}:${payload.expectedExpiresAt}`,
        );
    });
    return undefined;
  }

  private async managedMessage(message: DiscordMessage): Promise<GameServerUpdateThread | null> {
    if (message.guildId === null || !message.channel.isThread()) return null;
    return this.prisma.gameServerUpdateThread.findFirst({
      where: { threadId: message.channelId, guildId: message.guildId },
    });
  }

  private async syncHistory(
    managed: GameServerUpdateThread,
    excluded = new Set<string>(),
  ): Promise<void> {
    const thread = await this.fetchThread(managed.threadId);
    if (thread === null) {
      await scheduleGameServerUpdateReconcile(this.prisma, managed.gameServerId);
      return;
    }
    let before: string | undefined;
    let replacement: Message | null = null;
    for (;;) {
      const batch = await thread.messages.fetch({
        limit: 100,
        ...(before === undefined ? {} : { before }),
      });
      const messages = [...batch.values()].sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
      for (const candidate of messages) {
        if (!excluded.has(candidate.id) && (await this.isOfficial(candidate))) {
          replacement = candidate;
          break;
        }
      }
      if (replacement !== null || messages.length < 100) break;
      const oldest = messages.at(-1)?.id;
      if (oldest === undefined || oldest === before)
        throw new Error('Thread history pagination did not advance');
      before = oldest;
    }
    const data = replacement === null ? emptyPreview() : previewData(replacement);
    await this.prisma.$transaction(async (tx) => {
      const changed = Object.entries(data).some(([key, value]) => {
        const existing = managed[key as keyof typeof data];
        return (
          (existing instanceof Date ? existing.getTime() : existing) !==
          (value instanceof Date ? value.getTime() : value)
        );
      });
      if (changed) {
        const updated = await tx.gameServerUpdateThread.updateMany({
          where: {
            id: managed.id,
            threadId: managed.threadId,
            updatedAt: managed.updatedAt,
            latestMessageId: managed.latestMessageId,
          },
          data,
        });
        if (updated.count === 0) return;
        await this.refreshCards(
          tx,
          managed.gameServerId,
          `history:${managed.threadId}:${String(Date.now())}`,
        );
      }
      if (replacement !== null) await this.scheduleExpiry(tx, managed, replacement.createdAt);
    });
  }

  private async fetchParent(id: string, guildId: string): Promise<TextChannel> {
    const channel = await this.discord.channels.fetch(id, { force: true });
    if (channel?.type !== ChannelType.GuildText || channel.guildId !== guildId)
      throw new Error(
        'Managed update threads need an accessible regular text channel in the server guild',
      );
    const user = this.discord.user;
    if (
      user === null ||
      channel
        .permissionsFor(user)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageThreads,
        ]) !== true
    )
      throw new Error(
        'Missing update-thread permissions: View Channel, Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Manage Threads',
      );
    return channel;
  }

  private async findOwnedThread(
    parent: TextChannel,
    suffix: string,
  ): Promise<ThreadChannel | null> {
    const matches = (thread: ThreadChannel) =>
      thread.parentId === parent.id &&
      thread.ownerId === this.discord.user?.id &&
      thread.name.endsWith(suffix);
    const active = await parent.threads.fetchActive();
    const found = active.threads.find(matches);
    if (found !== undefined) return found;
    let before: Date | undefined;
    for (;;) {
      const page = await parent.threads.fetchArchived({
        type: 'public',
        limit: 100,
        ...(before === undefined ? {} : { before }),
      });
      const archived = page.threads.find(matches);
      if (archived !== undefined) return archived;
      if (!page.hasMore) return null;
      const dates = [...page.threads.values()]
        .map((thread) => thread.archiveTimestamp)
        .filter((date): date is number => date !== null);
      const next = Math.min(...dates);
      if (!Number.isFinite(next) || (before !== undefined && next >= before.getTime()))
        throw new Error('Archived thread pagination did not advance');
      before = new Date(next);
    }
  }

  private async fetchThread(id: string): Promise<ThreadChannel | null> {
    try {
      const channel = await this.discord.channels.fetch(id, { force: true });
      if (channel === null) throw new Error('Discord returned no channel without proving deletion');
      if (!channel.isThread()) throw new Error('Managed update resource is not a Discord thread');
      return channel;
    } catch (error: unknown) {
      if (error instanceof DiscordAPIError && error.code === 10_003) return null;
      throw error;
    }
  }

  private async isOfficial(message: Message): Promise<boolean> {
    // Phase 1 publishes staff posts. Bot/webhook traffic is never implicitly official.
    if (
      !message.inGuild() ||
      ![MessageType.Default, MessageType.Reply].includes(message.type) ||
      message.webhookId !== null ||
      message.author.bot
    )
      return false;
    let member = message.member;
    if (member === null) {
      try {
        member = await message.guild.members.fetch(message.author.id);
      } catch (error: unknown) {
        if (error instanceof DiscordAPIError && error.code === 10_007) return false;
        throw error;
      }
    }
    return message.channel
      .permissionsFor(member)
      .any([
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageMessages,
      ]);
  }

  private async scheduleExpiry(
    tx: Database,
    managed: GameServerUpdateThread,
    createdAt: Date,
  ): Promise<void> {
    const expiresAt = new Date(createdAt.getTime() + NEW_WINDOW_MS);
    if (expiresAt.getTime() <= Date.now()) return;
    await scheduleJob(tx, {
      type: 'GAME_SERVER_UPDATE_NOTIFICATION_EXPIRE',
      idempotencyKey: `game-server:update-notification:${managed.gameServerId}:${managed.type}:${expiresAt.toISOString()}`,
      payload: {
        gameServerId: managed.gameServerId,
        threadType: managed.type,
        expectedExpiresAt: expiresAt.toISOString(),
      },
      runAt: expiresAt,
    });
  }

  private async refreshCards(tx: Database, gameServerId: string, revision: string): Promise<void> {
    const cards = await tx.gameServerCard.findMany({
      where: { gameServerId },
      select: { id: true },
    });
    for (const card of cards)
      await scheduleGameServerCardRefresh(tx, card.id, new Date(), revision);
  }
}

export async function scheduleGameServerUpdateReconcile(
  prisma: Pick<PrismaClient, 'job'>,
  gameServerId: string,
): Promise<void> {
  await scheduleJob(prisma, {
    type: 'GAME_SERVER_UPDATE_RECONCILE',
    idempotencyKey: `game-server:update-reconcile:${gameServerId}`,
    payload: { gameServerId },
  });
}

function emptyPreview() {
  return {
    latestMessageId: null,
    latestMessageText: null,
    latestMessageAt: null,
    notificationStartedAt: null,
    notificationExpiresAt: null,
  };
}

function previewData(message: Message) {
  const expiresAt = new Date(message.createdTimestamp + NEW_WINDOW_MS);
  const fresh = expiresAt.getTime() > Date.now();
  return {
    latestMessageId: message.id,
    latestMessageText: normalizeUpdatePreview(message),
    latestMessageAt: message.createdAt,
    notificationStartedAt: fresh ? message.createdAt : null,
    notificationExpiresAt: fresh ? expiresAt : null,
  };
}

function managedThreadSuffix(gameServerId: string, type: ManagedType): string {
  return ` — ${type === 'ANNOUNCEMENTS' ? 'Announcements' : 'Changelog'} [${gameServerId}]`;
}

export function managedThreadName(
  displayName: string,
  gameServerId: string,
  type: ManagedType,
): string {
  const suffix = managedThreadSuffix(gameServerId, type);
  return `${displayName.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
}

export function normalizeUpdatePreview(message: Pick<Message, 'content' | 'attachments'>): string {
  const content = message.content
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>|@everyone|@here/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const value =
    content || (message.attachments.size > 0 ? '📎 Attachment posted' : 'Update posted');
  const chars = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
    (part) => part.segment,
  );
  return chars.length <= 140 ? value : `${chars.slice(0, 139).join('').trimEnd()}…`;
}
