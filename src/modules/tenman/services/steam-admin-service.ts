import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import type { SteamProfileService } from './steam-profile-service.js';

export interface PendingDispute {
  id: string;
  discordUserId: string;
  steamId64: string;
  createdAt: Date;
}

export type ResolveAction = 'REJECT' | 'FORCE_REPLACE' | 'FORCE_REMOVE';

export class SteamAdminService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly profile: SteamProfileService,
  ) {}

  public async listPendingDisputes(guildId: string): Promise<PendingDispute[]> {
    return this.prisma.steamAssignmentDispute.findMany({
      where: { guildId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, discordUserId: true, steamId64: true, createdAt: true },
    });
  }

  public async createDispute(
    guildId: string,
    discordUserId: string,
    steamId64: string,
    correlationId: string,
  ): Promise<{ id: string }> {
    const [existing] = await Promise.all([
      this.prisma.steamAssignmentDispute.findFirst({
        where: { guildId, discordUserId, steamId64, status: 'PENDING' },
      }),
      this.prisma.steamIdentity.findFirst({
        where: { discordUserId, invalidatedAt: null },
      }),
    ]);
    if (existing !== null) return { id: existing.id };
    const dispute = await this.prisma.steamAssignmentDispute.create({
      data: {
        guildId,
        discordUserId,
        steamId64,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        guildId,
        actorDiscordUserId: discordUserId,
        eventType: 'steam_assignment_dispute_requested',
        result: 'success',
        correlationId,
        metadata: { disputeId: dispute.id, steamId64 },
      },
    });
    return { id: dispute.id };
  }

  public async resolveDispute(
    disputeId: string,
    action: ResolveAction,
    actorDiscordUserId: string,
    correlationId: string,
    resolution?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const dispute = await transaction.steamAssignmentDispute.findUnique({
        where: { id: disputeId },
      });
      if (dispute === null)
        throw new PublicError('DISPUTE_NOT_FOUND', 'That dispute no longer exists.');
      if (dispute.status !== 'PENDING')
        throw new PublicError('DISPUTE_NOT_PENDING', 'That dispute has already been resolved.');

      const now = new Date();

      if (action === 'REJECT') {
        await transaction.steamAssignmentDispute.update({
          where: { id: disputeId },
          data: {
            status: 'REJECTED',
            actorDiscordUserId,
            resolution: resolution ?? null,
            resolvedAt: now,
          },
        });
      } else if (action === 'FORCE_REMOVE') {
        const active = await transaction.steamIdentity.findFirst({
          where: { discordUserId: dispute.discordUserId, invalidatedAt: null },
        });
        if (active !== null) {
          await transaction.steamIdentity.update({
            where: { id: active.id },
            data: { invalidatedAt: now, invalidationReason: 'STAFF_FORCE_REMOVE' },
          });
        }
        await transaction.steamAssignmentDispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED',
            actorDiscordUserId,
            resolution: resolution ?? null,
            resolvedAt: now,
          },
        });
      } else {
        const active = await transaction.steamIdentity.findFirst({
          where: { discordUserId: dispute.discordUserId, invalidatedAt: null },
        });
        if (active !== null) {
          await transaction.steamIdentity.update({
            where: { id: active.id },
            data: { invalidatedAt: now, invalidationReason: 'STAFF_FORCE_REPLACE' },
          });
        }
        await transaction.user.upsert({
          where: { discordUserId: dispute.discordUserId },
          update: {},
          create: { discordUserId: dispute.discordUserId, displayName: '' },
        });
        await transaction.steamIdentity.create({
          data: {
            discordUserId: dispute.discordUserId,
            steamId64: dispute.steamId64,
            assignmentSource: 'STAFF_OVERRIDE',
            provenance: 'STAFF_OVERRIDE',
          },
        });
        await transaction.steamAssignmentDispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED',
            actorDiscordUserId,
            resolution: resolution ?? null,
            resolvedAt: now,
          },
        });
      }

      await transaction.auditEvent.create({
        data: {
          guildId: dispute.guildId,
          actorDiscordUserId,
          eventType: 'steam_assignment_dispute_resolved',
          result: 'success',
          correlationId,
          metadata: {
            disputeId,
            action,
            targetDiscordUserId: dispute.discordUserId,
            steamId64: dispute.steamId64,
            resolution,
          },
        },
      });
    });
  }
}
