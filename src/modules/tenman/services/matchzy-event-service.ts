import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { MatchZyEvent } from '../integrations/matchzy/schemas.js';
import type { MatchArtifactService } from './match-artifact-service.js';
import { scheduleJob } from '../../../database/schedule-job.js';

export class MatchZyEventService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly artifacts: MatchArtifactService,
    private readonly demoCollectionDeadlineSeconds: number,
  ) {}

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
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          guildId: true,
          state: true,
          matchzyMatchId: true,
          selectedMap: true,
          resultStatus: true,
        },
      });
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
      if (event.event === 'demo_upload_ended') {
        await this.artifacts.processDemoUploadEnded(matchId, event, journal.id);
        await transaction.externalEvent.update({
          where: { id: journal.id },
          data: { processedAt: new Date() },
        });
        return 'processed';
      }
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
        const scoreUpdate = event.event === 'round_end' || event.event === 'map_result';
        const dashboardKey = `match-dashboard:${matchId}:${scoreUpdate ? 'score' : 'state'}`;
        await scheduleJob(transaction, {
          type: 'MATCH_DASHBOARD_REFRESH',
          idempotencyKey: dashboardKey,
          matchId,
          payload: { matchId },
          ...(scoreUpdate ? { runAt: new Date(Date.now() + 5_000) } : {}),
        });
        if (event.event === 'series_end') {
          if (match.resultStatus === 'PENDING') {
            await applyResult(transaction, matchId, event);
          }
          await transaction.demoReference.upsert({
            where: { matchId_mapNumber: { matchId, mapNumber: 0 } },
            update: {},
            create: {
              matchId,
              mapNumber: 0,
              mapName: match.selectedMap ?? 'unknown',
              status: 'EXPECTED',
              collectionDeadlineAt: new Date(
                Date.now() + this.demoCollectionDeadlineSeconds * 1000,
              ),
            },
          });
          await scheduleJob(transaction, {
            type: 'COLLECT_MATCH_ARTIFACTS',
            idempotencyKey: `artifacts:${matchId}`,
            matchId,
            payload: { matchId },
            runAt: new Date(Date.now() + 130_000),
          });
          await scheduleJob(transaction, {
            type: 'MATCH_RESULT_RECEIPT',
            idempotencyKey: `receipt:${matchId}`,
            matchId,
            payload: { matchId },
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

async function applyResult(
  transaction: Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
    ? T
    : never,
  matchId: string,
  event: Extract<MatchZyEvent, { event: 'series_end' }>,
): Promise<void> {
  const match = await transaction.match.findUnique({
    where: { id: matchId },
    include: { players: true },
  });
  if (match === null || match.resultStatus !== 'PENDING') return;
  const winner =
    event.winner.team === 'team1' ? 'TEAM_1' : event.winner.team === 'team2' ? 'TEAM_2' : null;
  if (winner === null) return;
  for (const player of match.players) {
    if (player.team !== 'TEAM_1' && player.team !== 'TEAM_2') continue;
    const won = player.team === winner;
    const stat = await transaction.playerGuildStats.upsert({
      where: {
        guildId_discordUserId: { guildId: match.guildId, discordUserId: player.discordUserId },
      },
      update: {
        wins: { increment: won ? 1 : 0 },
        losses: { increment: won ? 0 : 1 },
        matchesPlayed: { increment: 1 },
        rating: { increment: won ? 25 : -25 },
      },
      create: {
        guildId: match.guildId,
        discordUserId: player.discordUserId,
        rating: 1000 + (won ? 25 : -25),
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        matchesPlayed: 1,
      },
    });
    await transaction.matchRatingChange.create({
      data: {
        matchId,
        discordUserId: player.discordUserId,
        ratingBefore: stat.rating - (won ? 25 : -25),
        delta: won ? 25 : -25,
        ratingAfter: stat.rating,
      },
    });
  }
  await transaction.match.update({ where: { id: matchId }, data: { resultStatus: 'APPLIED' } });
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
