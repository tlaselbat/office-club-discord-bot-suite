import { randomUUID } from 'node:crypto';
import { ChannelType, type Client, type TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

/** A short lease limits abandoned work before any Discord create side effect. */
export const MATCH_RESOURCE_CREATION_LEASE_MS = 2 * 60 * 1000;
const ARCHIVE_PREFIX = 'archived-competitive-';

/**
 * Owns disposable match resources. A row is committed before Discord I/O; only
 * a proven bot-owned row may ever be deleted by this service.
 *
 * A creation attempt becomes permanently ambiguous once `creationIoStartedAt`
 * is persisted. This deliberately favors a manual/reconciliation path over
 * creating a duplicate or deleting a resource we cannot prove we own.
 */
export class MatchResourceService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
  ) {}

  public async ensureMatchTextChannel(matchId: string): Promise<string> {
    const resource = await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || !isReconcilable(match))
        throw new Error('Match resources are unavailable for this match state');
      const settings = await transaction.tenManSettings.findUnique({
        where: { guildId: match.guildId },
      });
      if (settings?.managedCategoryId === null || settings?.managedCategoryId === undefined) {
        throw new Error('Competitive category is not configured');
      }
      return transaction.matchDiscordResource.upsert({
        where: { matchId_resourceType: { matchId, resourceType: 'MATCH_TEXT_CHANNEL' } },
        update: {},
        create: { matchId, resourceType: 'MATCH_TEXT_CHANNEL', state: 'PENDING_CREATE' },
      });
    });
    if (resource.state === 'ACTIVE' && resource.discordId !== null) {
      const existing = await this.client.channels.fetch(resource.discordId).catch(() => null);
      if (existing !== null) return resource.discordId;
      await this.prisma.matchDiscordResource.updateMany({
        where: { id: resource.id, state: 'ACTIVE', discordId: resource.discordId },
        data: {
          discordId: null,
          createdByBot: false,
          state: 'PENDING_CREATE',
          creationAttemptId: null,
          creationLeaseExpiresAt: null,
          creationIoStartedAt: null,
        },
      });
      return this.ensureMatchTextChannel(matchId);
    }
    if (resource.state === 'CREATE_IN_FLIGHT') {
      if (await this.reclaimStalePreIoClaim(resource.id))
        return this.ensureMatchTextChannel(matchId);
      throw new Error('Match resource creation is ambiguous and requires recovery');
    }
    if (resource.state !== 'PENDING_CREATE') {
      throw new Error('Match resource creation is unavailable while cleanup is pending');
    }

    const attemptId = await this.claimCreation(resource.id);
    if (attemptId === null) return this.ensureMatchTextChannel(matchId);

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        guildId: true,
        matchzyMatchId: true,
        state: true,
        cleanupStatus: true,
      },
    });
    const settings =
      match === null
        ? null
        : await this.prisma.tenManSettings.findUnique({
            where: { guildId: match.guildId },
            select: { managedCategoryId: true },
          });
    if (
      match === null ||
      !isReconcilable(match) ||
      settings?.managedCategoryId === null ||
      settings?.managedCategoryId === undefined
    ) {
      await this.resetPending(resource.id, attemptId);
      throw new Error('Match resource configuration changed');
    }
    let guild;
    try {
      guild = await this.client.guilds.fetch(match.guildId);
    } catch (error) {
      await this.resetPending(resource.id, attemptId);
      throw error;
    }

    // Persist the point of no return immediately before the only create I/O.
    // If this process dies afterwards, reconciliation must not guess whether a
    // Discord channel was created.
    if (!(await this.markCreationIoStarted(resource.id, attemptId))) {
      throw new Error('Match resource creation was canceled before Discord I/O');
    }
    // A transport failure after the marker is intentionally ambiguous.
    const channel = await guild.channels.create({
      name: `match-${String(match.matchzyMatchId)}`,
      type: ChannelType.GuildText,
      parent: settings.managedCategoryId,
    });

    const afterCreate = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { state: true, cleanupStatus: true },
    });
    const activated =
      afterCreate !== null &&
      isReconcilable(afterCreate) &&
      (
        await this.prisma.matchDiscordResource.updateMany({
          where: {
            id: resource.id,
            state: 'CREATE_IN_FLIGHT',
            creationAttemptId: attemptId,
          },
          data: {
            discordId: channel.id,
            createdByBot: true,
            state: 'ACTIVE',
            creationLeaseExpiresAt: null,
          },
        })
      ).count === 1;
    if (!activated) {
      await this.recordAndArchiveCreatedChannel(resource.id, channel.id, channel);
      throw new Error('Match ended or cleanup started while its channel was being created');
    }
    return channel.id;
  }

  private async claimCreation(resourceId: string): Promise<string | null> {
    const attemptId = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.matchDiscordResource.updateMany({
      where: { id: resourceId, state: 'PENDING_CREATE' },
      data: {
        state: 'CREATE_IN_FLIGHT',
        creationAttemptId: attemptId,
        creationLeaseExpiresAt: new Date(now.getTime() + MATCH_RESOURCE_CREATION_LEASE_MS),
        creationIoStartedAt: null,
      },
    });
    return claimed.count === 1 ? attemptId : null;
  }

  private async reclaimStalePreIoClaim(resourceId: string): Promise<boolean> {
    const reclaimed = await this.prisma.matchDiscordResource.updateMany({
      where: {
        id: resourceId,
        state: 'CREATE_IN_FLIGHT',
        creationIoStartedAt: null,
        creationLeaseExpiresAt: { lt: new Date() },
      },
      data: {
        state: 'PENDING_CREATE',
        creationAttemptId: null,
        creationLeaseExpiresAt: null,
      },
    });
    return reclaimed.count === 1;
  }

  private async markCreationIoStarted(resourceId: string, attemptId: string): Promise<boolean> {
    const started = await this.prisma.matchDiscordResource.updateMany({
      where: {
        id: resourceId,
        state: 'CREATE_IN_FLIGHT',
        creationAttemptId: attemptId,
        creationIoStartedAt: null,
        creationLeaseExpiresAt: { gt: new Date() },
      },
      data: { creationIoStartedAt: new Date() },
    });
    return started.count === 1;
  }

  private async resetPending(resourceId: string, attemptId: string): Promise<void> {
    await this.prisma.matchDiscordResource.updateMany({
      where: {
        id: resourceId,
        state: 'CREATE_IN_FLIGHT',
        creationAttemptId: attemptId,
        creationIoStartedAt: null,
      },
      data: {
        state: 'PENDING_CREATE',
        creationAttemptId: null,
        creationLeaseExpiresAt: null,
      },
    });
  }

  private async recordAndArchiveCreatedChannel(
    resourceId: string,
    channelId: string,
    channel: TextChannel,
  ): Promise<void> {
    // Persist bot ownership before archiving. A crash after Discord returned
    // leaves a retryable, proven-owned PENDING_DELETE record.
    await this.prisma.matchDiscordResource.update({
      where: { id: resourceId },
      data: {
        discordId: channelId,
        createdByBot: true,
        state: 'PENDING_DELETE',
        creationLeaseExpiresAt: null,
      },
    });
    await this.archiveChannel(channel);
    await this.prisma.matchDiscordResource.update({
      where: { id: resourceId },
      data: { state: 'ARCHIVED', deletedAt: new Date() },
    });
  }

  /** Archives and locks a proven bot-owned match channel; it never deletes it. */
  public async archiveOwnedChannel(resourceId: string): Promise<void> {
    const resource = await this.prisma.matchDiscordResource.findUnique({
      where: { id: resourceId },
    });
    if (resource === null || resource.state === 'DELETED' || resource.state === 'ARCHIVED') return;
    if (!resource.createdByBot || resource.discordId === null) {
      if (resource.state === 'PENDING_CREATE') {
        await this.prisma.matchDiscordResource.updateMany({
          where: { id: resourceId, state: 'PENDING_CREATE' },
          data: { state: 'DELETED', deletedAt: new Date() },
        });
        return;
      }
      if (resource.state === 'CREATE_IN_FLIGHT') {
        // Before the durable I/O marker there is definitely no remote resource.
        // Afterwards leave an explicit tombstone for the creating worker; never
        // issue a destructive Discord operation against an unproven ID.
        await this.prisma.matchDiscordResource.updateMany({
          where: {
            id: resourceId,
            state: 'CREATE_IN_FLIGHT',
            creationIoStartedAt: resource.creationIoStartedAt,
          },
          data:
            resource.creationIoStartedAt === null
              ? { state: 'DELETED', deletedAt: new Date() }
              : { state: 'PENDING_DELETE' },
        });
        return;
      }
      if (resource.state === 'PENDING_DELETE') return;
      throw new Error('Refusing to archive an unowned match resource');
    }
    await this.prisma.matchDiscordResource.update({
      where: { id: resourceId },
      data: { state: 'PENDING_DELETE' },
    });
    const channel = await this.client.channels.fetch(resource.discordId).catch(() => null);
    if (channel !== null && channel.isTextBased())
      await this.archiveChannel(channel as TextChannel);
    await this.prisma.matchDiscordResource.update({
      where: { id: resourceId },
      data: { state: 'ARCHIVED', deletedAt: new Date() },
    });
  }

  private async archiveChannel(channel: TextChannel): Promise<void> {
    const name = channel.name.startsWith(ARCHIVE_PREFIX)
      ? channel.name
      : `${ARCHIVE_PREFIX}${channel.name}`.slice(0, 100);
    const reason = 'Competitive match archive; manual deletion required';
    await channel.edit({ name, reason });
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
      ViewChannel: false,
      SendMessages: false,
      Connect: false,
      Speak: false,
    });
  }
}

export function isReconcilable(match: { state: string; cleanupStatus: string }): boolean {
  return (
    !['FINISHED', 'CANCELED', 'FAILED'].includes(match.state) &&
    match.cleanupStatus === 'NOT_REQUIRED'
  );
}
