import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Minimal job-writing surface shared by PrismaClient and interactive transactions. */
export type JobScheduler = { job: Pick<PrismaClient['job'], 'upsert'> };

export interface ScheduledJob {
  type: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  matchId?: string;
  runAt?: Date;
}

/**
 * Idempotently schedules a durable job. Re-arming an existing key resets it to
 * pending and clears the retry counter and last error so a superseded failure
 * cannot keep the job parked.
 */
export async function scheduleJob(db: JobScheduler, job: ScheduledJob): Promise<void> {
  const runAt = job.runAt ?? new Date();
  await db.job.upsert({
    where: { idempotencyKey: job.idempotencyKey },
    update: { status: 'PENDING', runAt, attempts: 0, lastError: null },
    create: {
      ...(job.matchId === undefined ? {} : { matchId: job.matchId }),
      type: job.type,
      idempotencyKey: job.idempotencyKey,
      runAt,
      payload: job.payload,
    },
  });
}
