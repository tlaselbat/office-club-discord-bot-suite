import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { PhaseTimeoutService } from '../../../src/modules/tenman/services/phase-timeout-service.js';
import { schedulePhaseTimeout } from '../../../src/modules/tenman/services/phase-timeout-job.js';

function createPrisma(match: object | null): {
  prisma: PrismaClient;
  transaction: Record<string, unknown>;
} {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    match: {
      findUnique: vi.fn().mockResolvedValue(match),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tenManQueueEntry: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    tenManQueue: { upsert: vi.fn().mockResolvedValue(undefined) },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    job: { upsert: vi.fn().mockResolvedValue(undefined) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient,
    transaction: transaction as Record<string, unknown>,
  };
}

const expiredTeamSelection = {
  id: 'match-1',
  guildId: 'guild-1',
  workflowVersion: 'V2',
  state: 'TEAM_SELECTION',
  version: 4,
  phaseDeadlineAt: new Date(Date.now() - 1000),
  players: [
    { discordUserId: 'player-1', steamId64: 'steam-1', displayNameSnapshot: 'Player 1' },
    { discordUserId: 'player-2', steamId64: 'steam-2', displayNameSnapshot: 'Player 2' },
  ],
};

describe('PhaseTimeoutService', () => {
  it('cancels an expired draft phase, returns its players, and defers queue release to cleanup', async () => {
    const { prisma, transaction } = createPrisma(expiredTeamSelection);

    await new PhaseTimeoutService(prisma).expire('match-1', 'TEAM_SELECTION', 4, 'job-1');

    expect(
      (transaction.match as { updateMany: ReturnType<typeof vi.fn> }).updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'match-1', state: 'TEAM_SELECTION', version: 4 },
        data: expect.objectContaining({ state: 'CANCELED', cleanupStatus: 'PENDING' }),
      }),
    );
    expect(
      (transaction.tenManQueueEntry as { createMany: ReturnType<typeof vi.fn> }).createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.any(Object)]) }),
    );
    expect((transaction.job as { upsert: ReturnType<typeof vi.fn> }).upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: 'cleanup:match-1' } }),
    );
  });

  it('does nothing when a stale timeout no longer matches the persisted phase version', async () => {
    const { prisma, transaction } = createPrisma(expiredTeamSelection);

    await new PhaseTimeoutService(prisma).expire('match-1', 'TEAM_SELECTION', 3, 'job-1');

    expect(
      (transaction.match as { updateMany: ReturnType<typeof vi.fn> }).updateMany,
    ).not.toHaveBeenCalled();
    expect((transaction.job as { upsert: ReturnType<typeof vi.fn> }).upsert).not.toHaveBeenCalled();
  });
});

describe('schedulePhaseTimeout', () => {
  it('persists a state-and-version-bound deadline instead of relying on an in-memory timer', async () => {
    const job = { upsert: vi.fn().mockResolvedValue(undefined) };
    const deadline = new Date('2026-09-17T20:00:00.000Z');

    await schedulePhaseTimeout(
      { job } as never,
      'match-1',
      'MAP_VETO',
      7,
      deadline,
      'correlation-1',
    );

    expect(job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'phase-timeout:match-1:MAP_VETO:7' },
        create: expect.objectContaining({ runAt: deadline, type: 'MATCH_PHASE_TIMEOUT' }),
      }),
    );
  });
});
