import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { CleanupRepository } from '../orchestrator/cleanup.js';

const TERMINAL_MATCH_STATES = new Set(['FINISHED', 'CANCELED', 'FAILED']);

export class PrismaCleanupRepository implements CleanupRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async markRunning(matchId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null) throw new Error('Match not found');
      const from = match.cleanupStatus;
      await transaction.match.update({
        where: { id: matchId },
        data: { cleanupStatus: 'RUNNING' },
      });
      await transaction.cleanupTransition.create({
        data: { matchId, fromStatus: from, toStatus: 'RUNNING' },
      });
    });
  }

  public async markComplete(matchId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null) throw new Error('Match not found');
      const from = match.cleanupStatus;
      const releaseSlot = TERMINAL_MATCH_STATES.has(match.state);
      await transaction.match.update({
        where: { id: matchId },
        data: {
          cleanupStatus: 'COMPLETE',
          guildSlotActive: !releaseSlot,
        },
      });
      await transaction.cleanupTransition.create({
        data: { matchId, fromStatus: from, toStatus: 'COMPLETE' },
      });
    });
  }

  public async markRetry(matchId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null) throw new Error('Match not found');
      const from = match.cleanupStatus;
      await transaction.match.update({
        where: { id: matchId },
        data: { cleanupStatus: 'RETRY', failureReason: reason },
      });
      await transaction.cleanupTransition.create({
        data: { matchId, fromStatus: from, toStatus: 'RETRY', reason: reason.slice(0, 1000) },
      });
    });
  }

  public async revokeCredentials(matchId: string, now = new Date()): Promise<void> {
    await this.prisma.matchCredential.updateMany({
      where: { matchId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
