import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { assertCompetitiveBo1FiveVFive, gameProfileSchema } from '../domain/game-profile.js';
import { scheduleJob } from '../../../database/schedule-job.js';

export interface JoinQueueCommand {
  guildId: string;
  discordUserId: string;
  displayName: string;
  correlationId: string;
}

export type QueueJoinResult =
  | {
      status: 'joined';
      playersInQueue: number;
      queueSize: number;
      promotedMatchId: string | undefined;
    }
  | { status: 'already_queued'; playersInQueue: number; queueSize: number }
  | { status: 'missing_steam'; memberCount: number; missingDisplayNames: string[] }
  | { status: 'queue_banned'; expiresAt: Date | null; reason: string }
  | { status: 'queue_unavailable' }
  | { status: 'queue_full' }
  | { status: 'active_match'; matchId: string }
  | { status: 'parties_disabled' }
  | { status: 'party_forbidden' }
  | { status: 'party_guild_mismatch' }
  | { status: 'party_partially_queued' }
  | { status: 'party_duplicate_steam' };

export interface QueueLeaveResult {
  removedCount: number;
  wasParty: boolean;
}

export interface QueueStatus {
  playersInQueue: number;
  queueSize: number;
}

type QueueCandidate = {
  discordUserId: string;
  displayName: string;
  steamId64: string;
  partyId?: string;
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
        return { status: 'queue_unavailable' };
      }
      const profile = await transaction.gameProfile.findUnique({
        where: { key: settings.defaultGameProfileKey },
        select: {
          key: true,
          enabled: true,
          playersPerTeam: true,
          numMaps: true,
          serverSlots: true,
          mapAllowlist: true,
          matchzyOptions: true,
          allowedCvars: true,
        },
      });
      if (profile === null) {
        return { status: 'queue_unavailable' };
      }
      try {
        const parsedProfile = gameProfileSchema.parse({
          ...profile,
          matchzy: { ...(profile.matchzyOptions as object), cvars: profile.allowedCvars },
        });
        assertCompetitiveBo1FiveVFive(parsedProfile);
      } catch {
        return { status: 'queue_unavailable' };
      }
      if (settings.queueSize !== profile.playersPerTeam * 2) {
        return { status: 'queue_unavailable' };
      }
      const activeMatch = await transaction.match.findFirst({
        where: { guildId: command.guildId, guildSlotActive: true },
        select: { id: true },
      });
      if (activeMatch !== null) {
        return { status: 'active_match', matchId: activeMatch.id };
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
        return { status: 'party_guild_mismatch' };
      }
      if (party !== null && party.party.leaderDiscordUserId !== command.discordUserId) {
        return { status: 'party_forbidden' };
      }
      if (party !== null && !settings.partyEnabled) {
        return { status: 'parties_disabled' };
      }

      const memberIds =
        party === null
          ? [command.discordUserId]
          : party.party.members.map((member) => member.discordUserId);
      const [identities, activeBan, existingEntries, currentQueue] = await Promise.all([
        transaction.steamIdentity.findMany({
          where: { discordUserId: { in: memberIds }, invalidatedAt: null },
          orderBy: { assignedAt: 'desc' },
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
        transaction.tenManQueue.findUnique({
          where: { guildId: command.guildId },
          include: { entries: true },
        }),
      ]);
      const queueSize = settings.queueSize;
      const playersInQueue = currentQueue?.entries.length ?? 0;

      const identitiesByUser = new Map<string, string>();
      for (const identity of identities) {
        if (!identitiesByUser.has(identity.discordUserId))
          identitiesByUser.set(identity.discordUserId, identity.steamId64);
      }
      const missingDisplayNames =
        party === null
          ? memberIds.some((discordUserId) => !identitiesByUser.has(discordUserId))
            ? [command.displayName]
            : []
          : party.party.members
            .filter((member) => !identitiesByUser.has(member.discordUserId))
            .map((member) =>
              member.discordUserId === command.discordUserId
                ? command.displayName
                : member.user.displayName,
            );
      if (missingDisplayNames.length > 0) {
        return { status: 'missing_steam', memberCount: memberIds.length, missingDisplayNames };
      }
      if (activeBan !== null) {
        return {
          status: 'queue_banned',
          expiresAt: activeBan.expiresAt,
          reason: activeBan.reason,
        };
      }
      if (existingEntries.length > 0) {
        if (party !== null && existingEntries.length !== memberIds.length) {
          return { status: 'party_partially_queued' };
        }
        return { status: 'already_queued', playersInQueue, queueSize };
      }
      const steamIds = memberIds.map(
        (discordUserId) => identitiesByUser.get(discordUserId) as string,
      );
      if (new Set(steamIds).size !== steamIds.length) {
        return { status: 'party_duplicate_steam' };
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
              partyId: party.partyId,
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
      if (queue.status !== 'OPEN') {
        return { status: 'active_match', matchId: '' };
      }
      const entryCount = await transaction.tenManQueueEntry.count({
        where: { guildId: command.guildId },
      });
      if (entryCount + candidates.length > settings.queueSize) {
        return { status: 'queue_full' };
      }
      try {
        await transaction.tenManQueueEntry.createMany({
          data: candidates.map((candidate) => ({
            guildId: command.guildId,
            discordUserId: candidate.discordUserId,
            steamId64: candidate.steamId64,
            displayNameSnapshot: candidate.displayName,
            partyId: candidate.partyId ?? null,
          })),
        });
      } catch (error) {
        if (isUniqueConstraint(error)) {
          return { status: 'already_queued', playersInQueue, queueSize };
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
      return {
        status: 'joined',
        playersInQueue: entryCount + candidates.length,
        queueSize,
        promotedMatchId: matchId,
      };
    });
  }

  public async leave(
    guildId: string,
    discordUserId: string,
    correlationId: string,
  ): Promise<QueueLeaveResult> {
    return this.prisma.$transaction(async (transaction) => {
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
      return { removedCount: removed.count, wasParty: entry.partyId !== null };
    });
  }

  public async getStatus(guildId: string): Promise<QueueStatus> {
    const [settings, queue] = await Promise.all([
      this.prisma.tenManSettings.findUnique({ where: { guildId }, select: { queueSize: true } }),
      this.prisma.tenManQueue.findUnique({
        where: { guildId },
        include: { entries: { select: { discordUserId: true } } },
      }),
    ]);
    return {
      queueSize: settings?.queueSize ?? 10,
      playersInQueue: queue?.entries.length ?? 0,
    };
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
            partyId: entry.partyId ?? null,
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
  await scheduleJob(transaction, {
    type: 'QUEUE_PANEL_REFRESH',
    idempotencyKey: `queue-panel:${guildId}`,
    payload: { guildId },
  });
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
