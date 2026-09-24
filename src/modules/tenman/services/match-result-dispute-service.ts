import type { PrismaClient } from '../../../generated/prisma/client.js';
import { MatchHistoryService } from './match-history-service.js';

export type ResultDisputeResolution = 'REJECT' | 'REVERSE';

export class MatchResultDisputeService {
  public constructor(private readonly prisma: PrismaClient) {}

  /** Records a player-submitted dispute about a finished match result. */
  public async createDispute(
    matchId: string,
    discordUserId: string,
    reason: string,
    correlationId: string,
  ): Promise<{ id: string; status: 'created' | 'already_pending' }> {
    const existing = await this.prisma.matchResultDispute.findFirst({
      where: { matchId, discordUserId, status: 'PENDING' },
      select: { id: true },
    });
    if (existing !== null) {
      return { id: existing.id, status: 'already_pending' };
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { state: true },
    });
    if (match === null || !['FINISHED', 'CANCELED', 'FAILED'].includes(match.state)) {
      throw new Error('Match is not in a terminal state');
    }

    const dispute = await this.prisma.matchResultDispute.create({
      data: {
        matchId,
        discordUserId,
        reason: reason.slice(0, 1000),
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        matchId,
        guildId:
          (
            await this.prisma.match.findUnique({
              where: { id: matchId },
              select: { guildId: true },
            })
          )?.guildId ?? '',
        actorDiscordUserId: discordUserId,
        correlationId,
        eventType: 'match_result_dispute_created',
        result: 'success',
        metadata: { disputeId: dispute.id, reasonLength: dispute.reason.length },
      },
    });

    return { id: dispute.id, status: 'created' };
  }

  /** Lists pending result disputes for a guild, newest first. */
  public async listPending(guildId: string): Promise<
    Array<{
      id: string;
      matchId: string;
      discordUserId: string;
      reason: string;
      createdAt: Date;
    }>
  > {
    return this.prisma.matchResultDispute.findMany({
      where: { status: 'PENDING', match: { guildId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        matchId: true,
        discordUserId: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  /** Resolves a pending result dispute and optionally reverses the match result. */
  public async resolveDispute(
    disputeId: string,
    resolution: ResultDisputeResolution,
    reason: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const dispute = await transaction.matchResultDispute.findUnique({
        where: { id: disputeId },
        include: {
          match: { select: { id: true, guildId: true, resultStatus: true, state: true } },
        },
      });
      if (dispute === null) throw new Error('Dispute not found');
      if (dispute.status !== 'PENDING') throw new Error('Dispute is not pending');

      if (resolution === 'REVERSE') {
        const history = new MatchHistoryService(transaction as unknown as PrismaClient);
        await history.rollbackResultInTransaction(
          transaction as unknown as Parameters<PrismaClient['$transaction']>[0] extends (
            arg: infer T,
          ) => unknown
            ? T
            : never,
          dispute.match.id,
          actorDiscordUserId,
          correlationId,
        );
      }

      await transaction.matchResultDispute.update({
        where: { id: disputeId },
        data: {
          status: resolution === 'REVERSE' ? 'RESOLVED' : 'REJECTED',
          actorDiscordUserId,
          resolution: reason.slice(0, 1000),
          resolvedAt: new Date(),
        },
      });

      await transaction.auditEvent.create({
        data: {
          matchId: dispute.match.id,
          guildId: dispute.match.guildId,
          actorDiscordUserId,
          correlationId,
          eventType: 'match_result_dispute_resolved',
          result: 'success',
          metadata: { disputeId, resolution },
        },
      });
    });
  }
}
