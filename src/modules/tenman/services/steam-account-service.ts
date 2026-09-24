import type { PrismaClient } from '../../../generated/prisma/client.js';
import { parseSteamIdentifier } from '../domain/steam-id.js';
import type { SteamProfileService } from './steam-profile-service.js';

export type AssignResult =
  | { status: 'assigned'; steamId64: string; displayName: string | null }
  | { status: 'replaced'; steamId64: string; displayName: string | null }
  | { status: 'already_assigned'; steamId64: string; displayName: string | null }
  | { status: 'duplicate'; steamId64: string }
  | { status: 'invalid_input' }
  | { status: 'api_unavailable' }
  | { status: 'locked'; reason: 'QUEUED' | 'MATCH' };

export type RemoveResult =
  | { status: 'removed' }
  | { status: 'no_assignment' }
  | { status: 'locked'; reason: 'QUEUED' | 'MATCH' };

export interface AssignSteamAccountCommand {
  discordUserId: string;
  guildId: string;
  rawInput: string;
  correlationId: string;
  actorDiscordUserId?: string;
  displayName?: string;
}

export interface RemoveSteamAccountCommand {
  discordUserId: string;
  guildId: string;
  correlationId: string;
  actorDiscordUserId?: string;
}

/**
 * Manages self-reported Steam account assignment.
 *
 * Important security property: a successfully assigned Steam ID proves only that
 * this Discord user asked to use it. It does not prove ownership of the Steam
 * account. The UI and copy must preserve this distinction.
 */
export class SteamAccountService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly profile: SteamProfileService,
  ) {}

  public async findActive(
    discordUserId: string,
  ): Promise<{ steamId64: string; assignedAt: Date } | null> {
    const identity = await this.prisma.steamIdentity.findFirst({
      where: { discordUserId, invalidatedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    if (identity === null) return null;
    return { steamId64: identity.steamId64, assignedAt: identity.assignedAt };
  }

  public async assign(command: AssignSteamAccountCommand): Promise<AssignResult> {
    const normalized = await this.normalizeInput(command.rawInput);
    if (normalized === null) return { status: 'invalid_input' };
    if (normalized === 'api_unavailable') return { status: 'api_unavailable' };

    const profilePromise = this.profile.getPlayerSummary(normalized.steamId64).catch(() => null);
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.discordUserId}, 1))`;
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalized.steamId64}, 2))`;

      const lock = await isSteamIdentityLocked(transaction, command.discordUserId);
      if (lock.locked) return { status: 'locked', reason: lock.reason } as const;

      const existingActive = await transaction.steamIdentity.findFirst({
        where: { discordUserId: command.discordUserId, invalidatedAt: null },
      });
      const duplicateActive = await transaction.steamIdentity.findFirst({
        where: { steamId64: normalized.steamId64, invalidatedAt: null },
      });

      if (duplicateActive !== null && duplicateActive.discordUserId !== command.discordUserId) {
        return { status: 'duplicate', steamId64: normalized.steamId64 } as const;
      }

      const sameAsCurrent =
        existingActive !== null && existingActive.steamId64 === normalized.steamId64;
      if (sameAsCurrent) {
        return {
          status: 'already_assigned',
          steamId64: normalized.steamId64,
          identity: existingActive,
        } as const;
      }

      const now = new Date();
      if (existingActive !== null) {
        await transaction.steamIdentity.update({
          where: { id: existingActive.id },
          data: {
            invalidatedAt: now,
            invalidationReason: 'SELF_REPLACED',
          },
        });
      }

      await transaction.user.upsert({
        where: { discordUserId: command.discordUserId },
        update:
          command.displayName === undefined || command.displayName === ''
            ? {}
            : { displayName: command.displayName },
        create: { discordUserId: command.discordUserId, displayName: command.displayName ?? '' },
      });

      const created = await transaction.steamIdentity.create({
        data: {
          discordUserId: command.discordUserId,
          steamId64: normalized.steamId64,
          assignedAt: now,
          assignmentSource: 'MODAL_SELF_ASSIGN',
          provenance: 'SELF_ASSIGNMENT',
        },
      });

      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId ?? command.discordUserId,
          eventType: existingActive === null ? 'steam_account_assigned' : 'steam_account_replaced',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {
            steamId64: normalized.steamId64,
            previousSteamId64: existingActive?.steamId64 ?? null,
          },
        },
      });

      return {
        status: existingActive === null ? ('assigned' as const) : ('replaced' as const),
        steamId64: normalized.steamId64,
        identity: created,
      };
    });

    const profile = await profilePromise;
    const displayName = profile?.displayName ?? null;

    switch (result.status) {
      case 'assigned':
      case 'replaced':
      case 'already_assigned':
        return { ...result, displayName };
      default:
        return result;
    }
  }

  /**
   * Removes the caller's active assignment. Blocked while the identity is
   * locked by queue membership or a nonterminal match — same guard as
   * reassignment. Invoked by the self-service account UI.
   */
  public async remove(command: RemoveSteamAccountCommand): Promise<RemoveResult> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.discordUserId}, 1))`;

      const lock = await isSteamIdentityLocked(transaction, command.discordUserId);
      if (lock.locked) return { status: 'locked', reason: lock.reason };

      const active = await transaction.steamIdentity.findFirst({
        where: { discordUserId: command.discordUserId, invalidatedAt: null },
      });
      if (active === null) return { status: 'no_assignment' };

      await transaction.steamIdentity.update({
        where: { id: active.id },
        data: { invalidatedAt: new Date(), invalidationReason: 'SELF_REMOVED' },
      });

      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId ?? command.discordUserId,
          eventType: 'steam_account_removed',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { steamId64: active.steamId64 },
        },
      });

      return { status: 'removed' };
    });
  }

  private async normalizeInput(
    rawInput: string,
  ): Promise<{ steamId64: string } | 'api_unavailable' | null> {
    const parsed = parseSteamIdentifier(rawInput);
    if (parsed === null) return null;
    if (parsed.type !== 'VANITY_URL') return { steamId64: parsed.steamId64 };

    const resolved = await this.profile.resolveVanityUrl(parsed.steamId64);
    if (resolved === null) return 'api_unavailable';
    return { steamId64: resolved };
  }
}

export async function isSteamIdentityLocked(
  prisma: {
    tenManQueueEntry: { findFirst: (args: { where: object }) => Promise<unknown> };
    matchPlayer: { findFirst: (args: { where: object }) => Promise<unknown> };
  },
  discordUserId: string,
): Promise<{ locked: false } | { locked: true; reason: 'QUEUED' | 'MATCH' }> {
  const queued = await prisma.tenManQueueEntry.findFirst({
    where: { discordUserId },
  });
  if (queued !== null) return { locked: true, reason: 'QUEUED' };

  const activeMatch = await prisma.matchPlayer.findFirst({
    where: {
      discordUserId,
      match: {
        OR: [
          { state: { notIn: ['FINISHED', 'CANCELED', 'FAILED'] } },
          { cleanupStatus: { notIn: ['NOT_REQUIRED', 'COMPLETE'] } },
        ],
      },
    },
  });
  if (activeMatch !== null) return { locked: true, reason: 'MATCH' };

  return { locked: false };
}
