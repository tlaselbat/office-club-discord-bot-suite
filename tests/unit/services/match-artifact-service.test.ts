import { describe, expect, it, vi } from 'vitest';
import { MatchArtifactService } from '../../../src/modules/tenman/services/match-artifact-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import type { DatHostClient } from '../../../src/modules/tenman/integrations/dathost/client.js';
import type { ArtifactStorage } from '../../../src/modules/tenman/services/artifact-storage.js';

const matchId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createMocks() {
  const refs: {
    id: string;
    matchId: string;
    mapNumber: number;
    status: string;
    sourceFilename: string | null;
    collectionDeadlineAt: Date;
    retryCount: number;
  }[] = [];
  const audits: object[] = [];
  let refId = 0;
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
    ),
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    demoReference: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { matchId_mapNumber: { matchId: string; mapNumber: number } };
        }) =>
          refs.find(
            (r) =>
              r.matchId === where.matchId_mapNumber.matchId &&
              r.mapNumber === where.matchId_mapNumber.mapNumber,
          ) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { matchId: string } }) =>
        refs.filter((r) => r.matchId === where.matchId),
      ),
      create: vi.fn(async ({ data }: { data: (typeof refs)[0] }) => {
        refId += 1;
        const created = { ...data, id: `ref-${String(refId)}` };
        refs.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        const ref = refs.find((r) => r.id === where.id);
        if (ref === undefined) throw new Error('Not found');
        Object.assign(ref, data);
        return ref;
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: object }) => {
        audits.push(data);
      }),
    },
    job: {
      upsert: vi.fn(async ({ create }: { create: object }) => create),
    },
    match: {
      findUnique: vi.fn(async () => ({
        id: matchId,
        guildId: 'guild-1',
        dathostServerId: 'server-1',
        demoReferences: refs,
      })),
    },
  } as unknown as PrismaClient;

  const dathost = {
    downloadFile: vi.fn(),
  } as unknown as DatHostClient;

  const storage: ArtifactStorage = {
    available: true,
    upload: vi.fn(async () => ({ storageKey: 'demos/test.dem', byteCount: 1234 })),
    getSignedDownloadUrl: vi.fn(),
  };

  return { prisma, dathost, storage, refs, audits };
}

describe('MatchArtifactService', () => {
  it('records an expected demo reference', async () => {
    const { prisma, dathost, storage, refs } = createMocks();
    const service = new MatchArtifactService(prisma, dathost, storage);
    await service.recordExpected(matchId, 0, 'de_mirage', 1800, 'corr-1');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.status).toBe('EXPECTED');
    expect(refs[0]?.collectionDeadlineAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('processes a successful demo_upload_ended event', async () => {
    const { prisma, dathost, storage, refs } = createMocks();
    const service = new MatchArtifactService(prisma, dathost, storage);
    await service.processDemoUploadEnded(
      matchId,
      {
        event: 'demo_upload_ended',
        matchid: 1,
        map_number: 0,
        filename: 'match.dem',
        success: true,
      } as never,
      'corr-upload',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.status).toBe('SOURCE_READY');
    expect(refs[0]?.sourceFilename).toBe('match.dem');
  });

  it('marks references unavailable when storage is not configured', async () => {
    const { prisma, dathost, refs } = createMocks();
    refs.push({
      id: 'ref-1',
      matchId,
      mapNumber: 0,
      status: 'EXPECTED',
      sourceFilename: null,
      collectionDeadlineAt: new Date(Date.now() + 1800_000),
      retryCount: 0,
    });
    const storage: ArtifactStorage = {
      available: false,
      upload: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    };
    const service = new MatchArtifactService(prisma, dathost, storage);
    const reschedule = await service.collectArtifacts(matchId, 'corr-2');
    expect(reschedule).toBeUndefined();
    expect(refs[0]?.status).toBe('UNAVAILABLE');
  });

  it('waits to collect until a source filename is ready', async () => {
    const { prisma, dathost, storage, refs } = createMocks();
    refs.push({
      id: 'ref-1',
      matchId,
      mapNumber: 0,
      status: 'EXPECTED',
      sourceFilename: null,
      collectionDeadlineAt: new Date(Date.now() + 1800_000),
      retryCount: 0,
    });
    const service = new MatchArtifactService(prisma, dathost, storage);
    const reschedule = await service.collectArtifacts(matchId, 'corr-3');
    expect(reschedule).toBeUndefined();
    expect(refs[0]?.status).toBe('EXPECTED');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('expires references past the deadline', async () => {
    const { prisma, dathost, storage, refs } = createMocks();
    refs.push({
      id: 'ref-1',
      matchId,
      mapNumber: 0,
      status: 'EXPECTED',
      sourceFilename: null,
      collectionDeadlineAt: new Date(Date.now() - 1000),
      retryCount: 0,
    });
    const service = new MatchArtifactService(prisma, dathost, storage);
    const terminal = await service.ensureArtifactsTerminal(matchId);
    expect(terminal).toBe(true);
    expect(refs[0]?.status).toBe('EXPIRED');
  });
});
