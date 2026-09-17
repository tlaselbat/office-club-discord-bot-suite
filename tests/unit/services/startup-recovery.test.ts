import { describe, expect, it, vi } from 'vitest';
import { StartupRecovery } from '../../../src/modules/tenman/services/startup-recovery.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

function createMockPrisma(matches: object[]): PrismaClient {
  const jobUpsert = vi.fn().mockResolvedValue(undefined);
  const jobCreate = vi.fn().mockResolvedValue(undefined);
  return {
    match: {
      findMany: vi.fn().mockResolvedValue(matches),
    },
    job: {
      upsert: jobUpsert,
      create: jobCreate,
    },
    $transaction: vi.fn(async (callback) =>
      callback({
        match: { findMany: vi.fn().mockResolvedValue(matches) },
        job: { upsert: jobUpsert, create: jobCreate },
      }),
    ),
  } as unknown as PrismaClient;
}

describe('StartupRecovery', () => {
  it('enqueues provisioning job for a match stuck in SERVER_PROVISIONING', async () => {
    const prisma = createMockPrisma([
      {
        id: 'match-1',
        state: 'SERVER_PROVISIONING',
        cleanupStatus: 'NOT_REQUIRED',
        dathostServerId: null,
      },
    ]);
    const recovery = new StartupRecovery(prisma);
    await recovery.run();

    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'provision:match-1' },
        create: expect.objectContaining({ type: 'PROVISION_SERVER' }),
      }),
    );
  });

  it('enqueues boot poll for a booting match', async () => {
    const prisma = createMockPrisma([
      {
        id: 'match-2',
        state: 'SERVER_BOOTING',
        cleanupStatus: 'NOT_REQUIRED',
        dathostServerId: 'server-2',
      },
    ]);
    const recovery = new StartupRecovery(prisma);
    await recovery.run();

    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'poll-boot:match-2:server-2' },
        create: expect.objectContaining({ type: 'POLL_SERVER_BOOT' }),
      }),
    );
  });

  it('enqueues panel, voice, and cleanup for an active match', async () => {
    const prisma = createMockPrisma([
      {
        id: 'match-3',
        state: 'LIVE',
        cleanupStatus: 'RUNNING',
        dathostServerId: 'server-3',
      },
    ]);
    const recovery = new StartupRecovery(prisma);
    await recovery.run();

    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'panel:match-3:recovery' },
        create: expect.objectContaining({ type: 'PANEL_REFRESH' }),
      }),
    );
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'voice:match-3:recovery' },
        create: expect.objectContaining({ type: 'VOICE_RECONCILE' }),
      }),
    );
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'cleanup:match-3' },
        create: expect.objectContaining({ type: 'CLEANUP_MATCH' }),
      }),
    );
  });

  it('seeds orphan scan and matchzy reconcile jobs', async () => {
    const prisma = createMockPrisma([]);
    const recovery = new StartupRecovery(prisma);
    await recovery.run();

    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'orphan-scan' },
      }),
    );
    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'matchzy-reconcile' },
      }),
    );
  });
});
