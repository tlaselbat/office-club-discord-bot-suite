import type { PrismaClient } from '../generated/prisma/client.js';
import type { JobStore, LeasedJob } from '../jobs/worker.js';
import { randomUUID } from 'node:crypto';

interface JobRow {
  id: string;
  type: string;
  attempts: number;
  payload: unknown;
  lease_owner: string;
}

export class PrismaJobStore implements JobStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async lease(workerId: string, leaseUntil: Date): Promise<LeasedJob | null> {
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      WITH candidate AS (
        SELECT id FROM jobs
        WHERE (
          status IN ('PENDING', 'RETRY')
            AND run_at <= NOW()
            AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        ) OR (
          status = 'RUNNING'
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < NOW()
        )
        ORDER BY run_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'RUNNING', lease_owner = ${workerId + ':' + randomUUID()}, lease_expires_at = ${leaseUntil}, updated_at = NOW()
      WHERE id IN (SELECT id FROM candidate)
      RETURNING id, type, attempts, payload, lease_owner
    `;
    const row = rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          type: row.type,
          attempts: row.attempts,
          payload: row.payload,
          leaseToken: row.lease_owner,
        };
  }

  public async complete(jobId: string, leaseToken: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: { id: jobId, status: 'RUNNING', leaseOwner: leaseToken },
      data: { status: 'COMPLETE', leaseOwner: null, leaseExpiresAt: null, lastError: null },
    });
  }

  public async reschedule(jobId: string, runAt: Date, leaseToken: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: { id: jobId, status: 'RUNNING', leaseOwner: leaseToken },
      data: {
        status: 'PENDING',
        attempts: 0,
        runAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  public async retry(jobId: string, runAt: Date, error: string, leaseToken: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: { id: jobId, status: 'RUNNING', leaseOwner: leaseToken },
      data: {
        status: 'RETRY',
        attempts: { increment: 1 },
        runAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: error.slice(0, 2000),
      },
    });
  }

  public async fail(jobId: string, error: string, leaseToken: string): Promise<void> {
    await this.prisma.job.updateMany({
      where: { id: jobId, status: 'RUNNING', leaseOwner: leaseToken },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: error.slice(0, 2000),
      },
    });
  }
}
