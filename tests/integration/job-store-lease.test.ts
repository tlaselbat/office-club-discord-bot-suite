import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { PrismaJobStore } from '../../src/database/job-store.js';
import { scheduleJob } from '../../src/database/schedule-job.js';
import { createPrismaClient } from '../../src/database/prisma.js';

const url = process.env.TEST_DATABASE_URL;
const prisma = url === undefined ? null : createPrismaClient(url);

describe.skipIf(url === undefined)('durable job lease finalization', () => {
  const ids: string[] = [];
  beforeAll(async () => {
    if (prisma !== null) await prisma.$connect();
  });
  afterAll(async () => {
    if (prisma !== null) {
      if (ids.length) await prisma.job.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    }
  });

  it('rejects stale completion after re-lease and preserves re-arm', async () => {
    if (prisma === null) return;
    const key = `lease-test:${randomUUID()}`;
    const job = await prisma.job.create({
      data: { type: 'TEST', idempotencyKey: key, payload: {} },
    });
    ids.push(job.id);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        leaseOwner: 'worker-a:token',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await scheduleJob(prisma, { type: 'TEST', idempotencyKey: key, payload: {} });
    const store = new PrismaJobStore(prisma);
    await store.complete(job.id, 'worker-a:token');
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('PENDING');
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    // Isolate this handoff from unrelated jobs that other database tests may enqueue.
    const leaseTokenB = `worker-b:${randomUUID()}`;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        leaseOwner: leaseTokenB,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await store.complete(job.id, 'worker-a:token');
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('RUNNING');
    await store.complete(job.id, leaseTokenB);
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('COMPLETE');
  });
});
