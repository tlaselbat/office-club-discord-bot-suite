import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';

export interface JoinQueueCommand {
  guildId: string;
  discordUserId: string;
  displayName: string;
  correlationId: string;
}

export interface QueueJoinResult {
  promotedMatchId?: string;
}

type QueueCandidate = {
  discordUserId: string;
  displayName: string;
  steamId64: string;
};

/**
 * Owns the durable guild queue. All capacity-changing operations are
 * serialized by the existing guild advisory lock; Discord rendering happens
 * after these methods commit.
 */
export class QueueService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async join(command: JoinQueueCommand): Promise<QueueJoinResult> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const settings = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if (settings === null || !settings.enabled || settings.defaultGameProfileKey === null) {
        throw new PublicError('QUEUE_UNAVAILABLE', 'The 10man queue is unavailable.');
      }
      const profile = await transaction.gameProfile.findUnique({
        where: { key: settings.defaultGameProfileKey },
        select: { playersPerTeam: true },
      });
      if (
        profile === null ||
        profile.playersPerTeam !== 5 ||
        settings.queueSize !== profile.playersPerTeam * 2
      ) {
        throw new PublicError(
          'QUEUE_PROFILE_MISMATCH',
          'Queue size must match the selected game profile capacity.',
        );
      }
      const activeMatch = await transaction.match.findFirst({
        where: { guildId: command.guildId, guildSlotActive: true },
        select: { id: true },
      });
      if (activeMatch !== null) {
        throw new PublicError('QUEUE_LOCKED', 'A 10man is already being formed or played.');
      }

      const party = await transaction.tenManPartyMember.findUnique({
        where: { discordUserId: command.discordUserId },
        include: {
          party: {
            include: { members: { include: { user: { select: { displayName: true } } } } },
          },
        },
      });
      if (party !== null && party.party.guildId !== command.guildId) {
        throw new PublicError('PARTY_GUILD_MISMATCH', 'That party belongs to a different guild.');
      }
      if (party !== null && party.party.leaderDiscordUserId !== command.discordUserId) {
        throw new PublicError('PARTY_FORBIDDEN', 'Only the party leader can queue the party.');
      }
      if (party !== null && !settings.partyEnabled) {
        throw new PublicError('PARTIES_DISABLED', 'Parties are disabled for this queue.');
      }

      const memberIds =
        party === null
          ? [command.discordUserId]
          : party.party.members.map((member) => member.discordUserId);
      const [identities, activeBan, existingEntries] = await Promise.all([
        transaction.steamIdentity.findMany({
          where: { discordUserId: { in: memberIds }, invalidatedAt: null },
          orderBy: { verifiedAt: 'desc' },
        }),
        transaction.tenManQueueBan.findFirst({
          where: {
            guildId: command.guildId,
            discordUserId: { in: memberIds },
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
        transaction.tenManQueueEntry.findMany({
          where: { guildId: command.guildId, discordUserId: { in: memberIds } },
          select: { discordUserId: true },
        }),
      ]);
      const identitiesByUser = new Map<string, string>();
      for (const identity of identities) {
        if (!identitiesByUser.has(identity.discordUserId))
          identitiesByUser.set(identity.discordUserId, identity.steamId64);
      }
      if (memberIds.some((discordUserId) => !identitiesByUser.has(discordUserId))) {
        throw new PublicError(
          'STEAM_REQUIRED',
          'Every party member needs a verified Steam account before the party can queue.',
        );
      }
      if (activeBan !== null)
        throw new PublicError('QUEUE_BANNED', 'A party member is banned from this queue.');
      if (existingEntries.length > 0) {
        if (party !== null && existingEntries.length !== memberIds.length) {
          throw new PublicError(
            'PARTY_PARTIALLY_QUEUED',
            'This party has inconsistent queue entries and cannot be changed automatically.',
          );
        }
        throw new PublicError('ALREADY_QUEUED', 'You are already in this queue.');
      }
      const steamIds = memberIds.map(
        (discordUserId) => identitiesByUser.get(discordUserId) as string,
      );
      if (new Set(steamIds).size !== steamIds.length) {
        throw new PublicError(
          'PARTY_DUPLICATE_STEAM',
          'Party members must have distinct Steam accounts.',
        );
      }

      const candidates: QueueCandidate[] =
        party === null
          ? [
              {
                discordUserId: command.discordUserId,
                displayName: command.displayName,
                steamId64: steamIds[0] as string,
              },
            ]
          : party.party.members.map((member) => ({
              discordUserId: member.discordUserId,
              displayName:
                member.discordUserId === command.discordUserId
                  ? command.displayName
                  : member.user.displayName,
              steamId64: identitiesByUser.get(member.discordUserId) as string,
            }));
      await transaction.user.upsert({
        where: { discordUserId: command.discordUserId },
        update: { displayName: command.displayName },
        create: { discordUserId: command.discordUserId, displayName: command.displayName },
      });
      const queue = await transaction.tenManQueue.upsert({
        where: { guildId: command.guildId },
        update: {},
        create: { guildId: command.guildId },
      });
      if (queue.status !== 'OPEN') throw new PublicError('QUEUE_LOCKED', 'The queue is locked.');
      const entryCount = await transaction.tenManQueueEntry.count({
        where: { guildId: command.guildId },
      });
      if (entryCount + candidates.length > settings.queueSize)
        throw new PublicError('QUEUE_FULL', 'The queue is full.');
      try {
        await transaction.tenManQueueEntry.createMany({
          data: candidates.map((candidate) => ({
            guildId: command.guildId,
            discordUserId: candidate.discordUserId,
            steamId64: candidate.steamId64,
            displayNameSnapshot: candidate.displayName,
            partyId: party?.partyId ?? null,
          })),
        });
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw new PublicError('ALREADY_QUEUED', 'You are already in this queue.');
        }
        throw error;
      }
      await transaction.tenManQueue.update({
        where: { guildId: command.guildId },
        data: { version: { increment: 1 } },
      });
      await queuePanelRefresh(transaction, command.guildId);
      const matchId = await this.promoteIfFull(
        transaction,
        command.guildId,
        settings.queueSize,
        settings.defaultGameProfileKey,
        settings.readyTimeoutSeconds,
        command.correlationId,
      );
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.discordUserId,
          eventType: matchId === undefined ? 'queue_joined' : 'queue_promoted',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {
            matchId: matchId ?? null,
            partyId: party?.partyId ?? null,
            memberCount: candidates.length,
          },
        },
      });
      return matchId === undefined ? {} : { promotedMatchId: matchId };
    });
  }

  public async leave(guildId: string, discordUserId: string, correlationId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const entry = await transaction.tenManQueueEntry.findUnique({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        select: { partyId: true },
      });
      if (entry === null) throw new PublicError('NOT_QUEUED', 'You are not in this queue.');
      const removed = await transaction.tenManQueueEntry.deleteMany({
        where:
          entry.partyId === null ? { guildId, discordUserId } : { guildId, partyId: entry.partyId },
      });
      if (removed.count < 1) throw new PublicError('NOT_QUEUED', 'You are not in this queue.');
      await transaction.tenManQueue.update({
        where: { guildId },
        data: { version: { increment: 1 } },
      });
      await queuePanelRefresh(transaction, guildId);
      await transaction.auditEvent.create({
        data: {
          guildId,
          actorDiscordUserId: discordUserId,
          eventType: 'queue_left',
          result: 'success',
          correlationId,
          metadata: { partyId: entry.partyId, memberCount: removed.count },
        },
      });
    });
  }

  private async promoteIfFull(
    transaction: Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
      ? T
      : never,
    guildId: string,
    queueSize: number,
    profileKey: string,
    readyTimeoutSeconds: number,
    correlationId: string,
  ): Promise<string | undefined> {
    const entries = await transaction.tenManQueueEntry.findMany({
      where: { guildId },
      orderBy: { joinedAt: 'asc' },
    });
    if (entries.length !== queueSize) return undefined;
    const existing = await transaction.match.findFirst({
      where: { guildId, guildSlotActive: true },
    });
    if (existing !== null) return undefined;
    const deadline = new Date(Date.now() + readyTimeoutSeconds * 1000);
    const leader = entries.at(0);
    if (leader === undefined) throw new Error('Queue promotion requires a leader');
    const match = await transaction.match.create({
      data: {
        guildId,
        leaderDiscordUserId: leader.discordUserId,
        selectedGameProfileKey: profileKey,
        state: 'READY_CHECK',
        phaseDeadlineAt: deadline,
        players: {
          create: entries.map((entry) => ({
            discordUserId: entry.discordUserId,
            steamId64: entry.steamId64,
            displayNameSnapshot: entry.displayNameSnapshot,
          })),
        },
      },
    });
    await transaction.tenManQueueEntry.deleteMany({ where: { guildId } });
    await transaction.tenManQueue.update({
      where: { guildId },
      data: { status: 'LOCKED', version: { increment: 1 } },
    });
    await transaction.matchStateTransition.create({
      data: {
        matchId: match.id,
        fromState: 'CREATED',
        toState: 'READY_CHECK',
        source: 'QUEUE_PROMOTION',
      },
    });
    await transaction.job.create({
      data: {
        matchId: match.id,
        type: 'MATCH_PHASE_TIMEOUT',
        idempotencyKey: `phase-timeout:${match.id}:READY_CHECK:${String(match.version)}`,
        runAt: deadline,
        payload: {
          matchId: match.id,
          expectedState: 'READY_CHECK',
          expectedVersion: match.version,
          deadline: deadline.toISOString(),
          correlationId,
        },
      },
    });
    await transaction.job.create({
      data: {
        matchId: match.id,
        type: 'MATCH_RESOURCE_RECONCILE',
        idempotencyKey: `match-resources:${match.id}`,
        payload: { matchId: match.id },
      },
    });
    return match.id;
  }
}

async function queuePanelRefresh(
  transaction: Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
    ? T
    : never,
  guildId: string,
): Promise<void> {
  await transaction.job.upsert({
    where: { idempotencyKey: `queue-panel:${guildId}` },
    update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
    create: {
      type: 'QUEUE_PANEL_REFRESH',
      idempotencyKey: `queue-panel:${guildId}`,
      payload: { guildId },
    },
  });
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
