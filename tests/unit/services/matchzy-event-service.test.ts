import { describe, expect, it, vi } from 'vitest';
import { MatchZyEventService } from '../../../src/modules/tenman/services/matchzy-event-service.js';
import type { MatchArtifactService } from '../../../src/modules/tenman/services/match-artifact-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const matchId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createMockPrisma(matchOverrides: object = {}): PrismaClient {
  const externalEvents = new Map<string, { id: string; payloadHash: string }>();
  const state = {
    match: {
      id: matchId,
      matchzyMatchId: 42,
      version: 1,
      resultStatus: 'APPLIED',
      players: [],
      state: 'LIVE',
      cleanupStatus: 'NOT_REQUIRED',
      ...matchOverrides,
    },
    eventIdCounter: 0,
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
    ),
    externalEvent: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            matchId_provider_dedupeKey: { matchId: string; provider: string; dedupeKey: string };
          };
        }) => {
          return (
            externalEvents.get(
              `${where.matchId_provider_dedupeKey.provider}:${where.matchId_provider_dedupeKey.dedupeKey}`,
            ) ?? null
          );
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            matchId: string;
            provider: string;
            eventType: string;
            dedupeKey: string;
            payload: object;
            payloadHash: string;
          };
        }) => {
          state.eventIdCounter += 1;
          const id = `event-${String(state.eventIdCounter)}`;
          externalEvents.set(`${data.provider}:${data.dedupeKey}`, {
            id,
            payloadHash: data.payloadHash,
          });
          return { id };
        },
      ),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    match: {
      findUnique: vi.fn().mockResolvedValue(state.match),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    demoReference: { upsert: vi.fn().mockResolvedValue(undefined) },
    job: { upsert: vi.fn().mockResolvedValue(undefined) },
    reconciliationEvent: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as PrismaClient;
  return prisma;
}

function seriesEndEvent() {
  return {
    event: 'series_end',
    matchid: 42,
    team1_series_score: 13,
    team2_series_score: 9,
    winner: { team: 'team1' },
    team1: { score: 13 },
    team2: { score: 9 },
  };
}

function createMockArtifacts(): MatchArtifactService {
  return {
    processDemoUploadEnded: vi.fn().mockResolvedValue(undefined),
    recordExpected: vi.fn().mockResolvedValue(undefined),
    collectArtifacts: vi.fn().mockResolvedValue(undefined),
    ensureArtifactsTerminal: vi.fn().mockResolvedValue(true),
  } as unknown as MatchArtifactService;
}

describe('MatchZyEventService', () => {
  it('processes a series_end event and enqueues cleanup', async () => {
    const prisma = createMockPrisma();
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);

    const result = await service.ingest(matchId, seriesEndEvent() as never);

    expect(result).toBe('processed');
    expect(prisma.match.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: matchId }),
        data: expect.objectContaining({ state: 'FINISHED', cleanupStatus: 'PENDING' }),
      }),
    );
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `cleanup:${matchId}` },
        create: expect.objectContaining({ type: 'CLEANUP_MATCH' }),
      }),
    );
  });

  it('deduplicates identical series_end events', async () => {
    const prisma = createMockPrisma();
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);

    await service.ingest(matchId, seriesEndEvent() as never);
    const result = await service.ingest(matchId, seriesEndEvent() as never);

    expect(result).toBe('duplicate');
    expect(prisma.matchStateTransition.create).toHaveBeenCalledTimes(1);
  });

  it('coalesces score updates into one delayed dashboard job key', async () => {
    const prisma = createMockPrisma();
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);
    await service.ingest(matchId, {
      event: 'round_end',
      matchid: 42,
      map_number: 1,
      round_number: 1,
      team1: { score: 1 },
      team2: { score: 0 },
    } as never);
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `match-dashboard:${matchId}:score` },
        create: expect.objectContaining({ type: 'MATCH_DASHBOARD_REFRESH' }),
      }),
    );
  });

  it('rejects events with a mismatched match id', async () => {
    const prisma = createMockPrisma({ matchzyMatchId: 99 });
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);

    await expect(service.ingest(matchId, seriesEndEvent() as never)).rejects.toThrow(
      'MatchZy match ID mismatch',
    );
  });

  it('finishes when series_end arrives without going_live', async () => {
    const prisma = createMockPrisma({ state: 'MATCH_LOADED', resultStatus: 'PENDING' });
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);
    await service.ingest(matchId, seriesEndEvent() as never);
    expect(prisma.match.updateMany).toHaveBeenCalled();
    expect(prisma.match.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'FINISHED', cleanupStatus: 'PENDING' }),
      }),
    );
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `match-dashboard:${matchId}:state` },
      }),
    );
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: `cleanup:${matchId}` },
      }),
    );
  });

  it('records a conflicting payload hash for the same logical event', async () => {
    const prisma = createMockPrisma();
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);
    await service.ingest(matchId, seriesEndEvent() as never);
    await service.ingest(matchId, { ...seriesEndEvent(), team1_series_score: 12 } as never);
    expect(prisma.reconciliationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: 'CONFLICT' }),
      }),
    );
  });

  it('does not record a conflict for an identical duplicate payload', async () => {
    const prisma = createMockPrisma();
    const service = new MatchZyEventService(prisma, createMockArtifacts(), 1800);
    await service.ingest(matchId, seriesEndEvent() as never);
    await service.ingest(matchId, seriesEndEvent() as never);
    expect(prisma.reconciliationEvent.create).not.toHaveBeenCalled();
  });
});
