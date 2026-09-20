import { describe, expect, it, vi } from 'vitest';
import { failProvisioning } from '../../../src/modules/tenman/jobs/handlers.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const matchId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createPrisma(): PrismaClient {
  const prisma = {
    match: {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({ id: matchId, state: 'SERVER_PROVISIONING', dathostServerId: null })
        .mockResolvedValueOnce({
          id: matchId,
          state: 'FAILED',
          cleanupStatus: 'NOT_REQUIRED',
          guildId: 'guild-1',
        }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    provisioningAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    tenManQueue: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    job: { upsert: vi.fn().mockResolvedValue(undefined) },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (callback: (client: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
    ),
  } as unknown as PrismaClient;
  return prisma;
}

describe('provisioning permanent failure', () => {
  it('refreshes the registered dashboard job and reopens a queue when cleanup is unnecessary', async () => {
    const prisma = createPrisma();

    await failProvisioning(prisma, matchId, 'provisioning failed');

    expect(prisma.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ type: 'MATCH_DASHBOARD_REFRESH' }),
      }),
    );
    expect(prisma.tenManQueue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { guildId: 'guild-1', status: 'LOCKED' } }),
    );
  });
});
