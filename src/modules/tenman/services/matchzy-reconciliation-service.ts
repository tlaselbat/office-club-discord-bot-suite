import type { Logger } from 'pino';
import type { MatchState, PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostClient } from '../integrations/dathost/client.js';

const ACTIVE_MATCH_STATES = new Set(['MATCH_LOADED', 'WARMUP', 'LIVE', 'PAUSED']);

export class MatchZyReconciliationService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly dathost: DatHostClient,
    private readonly staleAfterMs: number,
    private readonly logger: Logger,
  ) {}

  public async runPeriodicReconciliation(): Promise<void> {
    const now = Date.now();
    const matches = await this.prisma.match.findMany({
      where: {
        state: { in: [...ACTIVE_MATCH_STATES] as MatchState[] },
        dathostServerId: { not: null },
      },
      select: {
        id: true,
        state: true,
        dathostServerId: true,
        lastMatchzyEventAt: true,
      },
    });

    for (const match of matches) {
      if (match.dathostServerId === null) continue;
      try {
        await this.reconcileMatch(match.id, match.dathostServerId, now);
      } catch (error: unknown) {
        this.logger.error(
          { err: error, matchId: match.id },
          'MatchZy reconciliation failed for match',
        );
      }
    }
  }

  private async reconcileMatch(matchId: string, serverId: string, now: number): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        state: true,
        lastMatchzyEventAt: true,
        cleanupStatus: true,
      },
    });
    if (match === null || !ACTIVE_MATCH_STATES.has(match.state)) return;

    const server = await this.dathost.getServer(serverId);
    const lastEventAt = match.lastMatchzyEventAt?.getTime() ?? 0;
    const stale = now - lastEventAt > this.staleAfterMs;

    if (server === null || (!server.on && !server.booting)) {
      if (match.cleanupStatus === 'COMPLETE' || match.cleanupStatus === 'NOT_REQUIRED') return;
      this.logger.info(
        { matchId, serverId, stale, state: match.state },
        'Server is gone and series_end was not received; recovering as finished',
      );
      await this.prisma.$transaction(async (transaction) => {
        await transaction.match.update({
          where: { id: matchId },
          data: {
            state: 'FINISHED',
            cleanupStatus: 'PENDING',
            finishedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: match.state,
            toState: 'FINISHED',
            source: 'RECONCILIATION',
            reason: 'Server gone without series_end',
          },
        });
        await transaction.reconciliationEvent.create({
          data: {
            matchId,
            observation: {
              source: 'MATCHZY_RECONCILE',
              serverId,
              lastEventAt,
              stale,
              serverPresent: server !== null,
            },
            correction: { state: 'FINISHED', cleanupStatus: 'PENDING' },
            result: 'recovered_finished',
          },
        });
        await transaction.job.upsert({
          where: { idempotencyKey: `cleanup:${matchId}` },
          update: {},
          create: {
            matchId,
            type: 'CLEANUP_MATCH',
            idempotencyKey: `cleanup:${matchId}`,
            payload: { matchId },
          },
        });
        await transaction.job.create({
          data: {
            matchId,
            type: 'MATCH_DASHBOARD_REFRESH',
            idempotencyKey: `match-dashboard:${matchId}:reconciliation`,
            payload: { matchId },
          },
        });
      });
      return;
    }

    if (stale) {
      this.logger.warn(
        { matchId, serverId, lastEventAt, state: match.state },
        'MatchZy events are stale but server still reports on',
      );
      await this.prisma.reconciliationEvent.create({
        data: {
          matchId,
          observation: {
            source: 'MATCHZY_RECONCILE',
            serverId,
            lastEventAt,
            serverOn: server.on,
            serverBooting: server.booting,
          },
          result: 'stale_no_action',
        },
      });
    }
  }
}
