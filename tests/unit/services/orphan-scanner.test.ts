import { describe, expect, it, vi } from 'vitest';
import { OrphanScanner } from '../../../src/modules/tenman/services/orphan-scanner.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import type { DatHostServer } from '../../../src/modules/tenman/integrations/dathost/schemas.js';

function createMockPrisma(overrides: { match?: object; attempt?: object } = {}): PrismaClient {
  return {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'match-1',
        dathostServerId: 'server-1',
        cleanupStatus: 'NOT_REQUIRED',
        ...overrides.match,
      }),
    },
    provisioningAttempt: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'attempt-1',
        dathostServerId: 'server-1',
        status: 'COMPLETE',
        ...overrides.attempt,
      }),
    },
    reconciliationEvent: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PrismaClient;
}

function server(id: string, userData: string | null): DatHostServer {
  return {
    id,
    name: `server-${id}`,
    user_data: userData,
    on: false,
    booting: false,
    ip: '1.1.1.1',
    ports: { game: 27015 },
  } as DatHostServer;
}

describe('OrphanScanner', () => {
  it('classifies an accounted server as accounted', async () => {
    const prisma = createMockPrisma();
    const dathost = {
      listServers: vi.fn().mockResolvedValue([server('server-1', 'tenman:match-1:attempt-1')]),
    };
    const scanner = new OrphanScanner(prisma, dathost, new Set());
    const reports = await scanner.scan();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      serverId: 'server-1',
      disposition: 'accounted',
      matchId: 'match-1',
    });
  });

  it('excludes configured template servers', async () => {
    const prisma = createMockPrisma();
    const dathost = {
      listServers: vi.fn().mockResolvedValue([server('template-1', 'tenman:match-1:attempt-1')]),
    };
    const scanner = new OrphanScanner(prisma, dathost, new Set(['template-1']));
    const reports = await scanner.scan();

    expect(reports).toHaveLength(0);
  });

  it('reports unknown marker as unknown', async () => {
    const prisma = createMockPrisma();
    const dathost = {
      listServers: vi.fn().mockResolvedValue([server('server-x', 'other:marker')]),
    };
    const scanner = new OrphanScanner(prisma, dathost, new Set());
    const reports = await scanner.scan();

    expect(reports[0]).toMatchObject({
      serverId: 'server-x',
      disposition: 'unknown',
    });
  });

  it('reports missing match record as orphan', async () => {
    const prisma = createMockPrisma();
    prisma.match.findUnique = vi.fn().mockResolvedValue(null);
    const dathost = {
      listServers: vi.fn().mockResolvedValue([server('server-2', 'tenman:match-1:attempt-1')]),
    };
    const scanner = new OrphanScanner(prisma, dathost, new Set());
    const reports = await scanner.scan();

    expect(reports[0]).toMatchObject({
      serverId: 'server-2',
      disposition: 'orphan',
    });
  });
});
