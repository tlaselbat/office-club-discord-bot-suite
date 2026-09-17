import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { MatchZyReconciliationService } from '../../../src/modules/tenman/services/matchzy-reconciliation-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import type { DatHostClient } from '../../../src/modules/tenman/integrations/dathost/client.js';

function createMockPrisma(matchOverrides: object = {}): PrismaClient {
  return {
    match: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'match-1',
          state: 'LIVE',
          dathostServerId: 'server-1',
          lastMatchzyEventAt: new Date(Date.now() - 1000),
          ...matchOverrides,
        },
      ]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'match-1',
        state: 'LIVE',
        lastMatchzyEventAt: new Date(Date.now() - 1000),
        cleanupStatus: 'NOT_REQUIRED',
        ...matchOverrides,
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    reconciliationEvent: { create: vi.fn().mockResolvedValue(undefined) },
    job: {
      upsert: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn(async (callback) =>
      callback({
        match: { update: vi.fn().mockResolvedValue(undefined) },
        matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
        reconciliationEvent: { create: vi.fn().mockResolvedValue(undefined) },
        job: {
          upsert: vi.fn().mockResolvedValue(undefined),
          create: vi.fn().mockResolvedValue(undefined),
        },
      }),
    ),
  } as unknown as PrismaClient;
}

function createMockDathost(server: { on: boolean; booting: boolean } | null): DatHostClient {
  return {
    getServer: vi.fn().mockResolvedValue(server),
  } as unknown as DatHostClient;
}

describe('MatchZyReconciliationService', () => {
  it('does nothing when server is still alive', async () => {
    const prisma = createMockPrisma();
    const dathost = createMockDathost({ on: true, booting: false });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const service = new MatchZyReconciliationService(prisma, dathost, 60_000, logger);

    await service.runPeriodicReconciliation();

    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it('recovers a finished match when server is gone', async () => {
    const prisma = createMockPrisma({ cleanupStatus: 'PENDING' });
    const dathost = createMockDathost(null);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const service = new MatchZyReconciliationService(prisma, dathost, 60_000, logger);

    await service.runPeriodicReconciliation();

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
