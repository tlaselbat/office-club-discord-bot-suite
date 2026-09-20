import type { PrismaClient } from '../../../generated/prisma/client.js';

type Transaction = Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
  ? T
  : never;

/** Schedules a durable, state/version-bound phase deadline. */
export async function schedulePhaseTimeout(
  transaction: Transaction,
  matchId: string,
  expectedState: 'TEAM_SELECTION' | 'MAP_VETO',
  expectedVersion: number,
  deadline: Date,
  correlationId: string,
): Promise<void> {
  await transaction.job.upsert({
    where: {
      idempotencyKey: `phase-timeout:${matchId}:${expectedState}:${String(expectedVersion)}`,
    },
    update: { status: 'PENDING', runAt: deadline, attempts: 0, lastError: null },
    create: {
      matchId,
      type: 'MATCH_PHASE_TIMEOUT',
      idempotencyKey: `phase-timeout:${matchId}:${expectedState}:${String(expectedVersion)}`,
      runAt: deadline,
      payload: {
        matchId,
        expectedState,
        expectedVersion,
        deadline: deadline.toISOString(),
        correlationId,
      },
    },
  });
}
