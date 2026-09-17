import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { MatchZyEvent } from '../integrations/matchzy/schemas.js';

export class MatchZyEventService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async ingest(matchId: string, event: MatchZyEvent): Promise<'processed' | 'duplicate'> {
    const payload = JSON.parse(JSON.stringify(event)) as object;
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const dedupeKey = eventDedupeKey(event, payloadHash);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.externalEvent.findUnique({
        where: { matchId_provider_dedupeKey: { matchId, provider: 'MATCHZY', dedupeKey } },
        select: { id: true },
      });
      if (existing !== null) return 'duplicate';
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || match.matchzyMatchId !== event.matchid)
        throw new Error('MatchZy match ID mismatch');
      const journal = await transaction.externalEvent.create({
        data: {
          matchId,
          provider: 'MATCHZY',
          eventType: event.event,
          dedupeKey,
          payload,
          payloadHash,
        },
      });
      const update = eventUpdate(match.state, event);
      if (update !== null) {
        await transaction.match.update({
          where: { id: matchId },
          data: {
            ...update.data,
            lastMatchzyEventAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (update.toState !== null && update.toState !== match.state) {
          await transaction.matchStateTransition.create({
            data: {
              matchId,
              fromState: match.state,
              toState: update.toState,
              source: 'MATCHZY_EVENT',
              eventId: journal.id,
            },
          });
        }
        await transaction.job.upsert({
          where: { idempotencyKey: `panel:${matchId}:event:${journal.id}` },
          update: {},
          create: {
            matchId,
            type: 'PANEL_REFRESH',
            idempotencyKey: `panel:${matchId}:event:${journal.id}`,
            payload: { matchId },
          },
        });
        if (event.event === 'series_end') {
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
        }
      } else {
        await transaction.match.update({
          where: { id: matchId },
          data: { lastMatchzyEventAt: new Date() },
        });
      }
      await transaction.externalEvent.update({
        where: { id: journal.id },
        data: { processedAt: new Date() },
      });
      return 'processed';
    });
  }
}

function eventDedupeKey(event: MatchZyEvent, payloadHash: string): string {
  if (event.event === 'round_end')
    return `round:${String(event.map_number)}:${String(event.round_number)}`;
  if (event.event === 'map_result') return `map:${String(event.map_number)}`;
  if (event.event === 'series_start' || event.event === 'series_end') return event.event;
  return `${event.event}:${payloadHash}`;
}

function eventUpdate(
  state: string,
  event: MatchZyEvent,
): { toState: 'WARMUP' | 'LIVE' | 'FINISHED' | null; data: object } | null {
  if (event.event === 'series_start' && state === 'MATCH_LOADED')
    return { toState: 'WARMUP', data: { state: 'WARMUP' } };
  if (event.event === 'going_live' && (state === 'MATCH_LOADED' || state === 'WARMUP'))
    return { toState: 'LIVE', data: { state: 'LIVE', startedAt: new Date() } };
  if (event.event === 'round_end' || event.event === 'map_result') {
    return {
      toState: null,
      data: { score: { team1: event.team1.score, team2: event.team2.score } },
    };
  }
  if (event.event === 'series_end' && (state === 'LIVE' || state === 'PAUSED')) {
    return {
      toState: 'FINISHED',
      data: {
        state: 'FINISHED',
        cleanupStatus: 'PENDING',
        result: {
          team1SeriesScore: event.team1_series_score,
          team2SeriesScore: event.team2_series_score,
          winner: event.winner,
        },
        finishedAt: new Date(),
      },
    };
  }
  return null;
}
