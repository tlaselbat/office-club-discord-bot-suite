import { describe, expect, it, vi } from 'vitest';
import { MatchResultDisputeService } from '../../../src/modules/tenman/services/match-result-dispute-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const matchId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const guildId = '12345678901234567';
const userId = 'user-1';

type Dispute = {
  id: string;
  status: string;
  matchId: string;
  discordUserId: string;
  reason: string;
};

function createPrisma(
  overrides: {
    disputes?: Dispute[];
    matchState?: string;
    resultStatus?: string;
    ratingChanges?: Array<{
      id: string;
      discordUserId: string;
      delta: number;
      reversedAt: Date | null;
    }>;
  } = {},
) {
  const disputes: Dispute[] = overrides.disputes ?? [];
  const matchState = overrides.matchState ?? 'FINISHED';
  const resultStatus = overrides.resultStatus ?? 'APPLIED';
  const ratingChanges = overrides.ratingChanges ?? [];

  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (callback) => callback(prisma)),
    matchResultDispute: {
      findFirst: vi
        .fn()
        .mockImplementation(
          ({ where }: { where: { matchId?: string; discordUserId?: string; status?: string } }) => {
            const found = disputes.find(
              (d: Dispute) =>
                d.matchId === where.matchId &&
                d.discordUserId === where.discordUserId &&
                d.status === (where.status ?? 'PENDING'),
            );
            return Promise.resolve(found ?? null);
          },
        ),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const found = disputes.find((d: Dispute) => d.id === where.id);
        return Promise.resolve(
          found
            ? {
                id: found.id,
                status: found.status,
                matchId: found.matchId,
                discordUserId: found.discordUserId,
                reason: found.reason,
                match: {
                  id: matchId,
                  guildId,
                  resultStatus,
                  state: matchState,
                },
              }
            : null,
        );
      }),
      findMany: vi.fn().mockResolvedValue(
        disputes
          .filter((d: Dispute) => d.status === 'PENDING')
          .map((d: Dispute) => ({
            id: d.id,
            status: d.status,
            matchId,
            discordUserId: d.discordUserId,
            reason: d.reason,
            createdAt: new Date(),
          })),
      ),
      create: vi.fn().mockImplementation(({ data }: { data: Omit<Dispute, 'id' | 'status'> }) => {
        const dispute: Dispute = {
          id: 'dispute-1',
          matchId: data.matchId,
          discordUserId: data.discordUserId,
          reason: data.reason,
          status: 'PENDING',
        };
        disputes.push(dispute);
        return Promise.resolve(dispute);
      }),
      update: vi
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Partial<Dispute> }) => {
            const index = disputes.findIndex((d: Dispute) => d.id === where.id);
            if (index >= 0) {
              const current = disputes[index] as Dispute;
              disputes[index] = Object.assign({}, current, data) as Dispute;
            }
            return Promise.resolve(disputes[index] as Dispute);
          },
        ),
    },
    match: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === matchId) {
          return Promise.resolve({
            id: matchId,
            guildId,
            state: matchState,
            resultStatus,
          });
        }
        return Promise.resolve(null);
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    matchRatingChange: {
      findMany: vi.fn().mockResolvedValue(ratingChanges),
      updateMany: vi.fn().mockResolvedValue({ count: ratingChanges.length }),
    },
    playerGuildStats: {
      update: vi.fn().mockResolvedValue(undefined),
    },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as PrismaClient;

  return { prisma, disputes };
}

describe('MatchResultDisputeService', () => {
  it('creates a new dispute for a terminal match', async () => {
    const { prisma } = createPrisma();

    const result = await new MatchResultDisputeService(prisma).createDispute(
      matchId,
      userId,
      'Wrong winner',
      'corr-1',
    );

    expect(result.status).toBe('created');
    expect(result.id).toBe('dispute-1');
  });

  it('returns existing pending dispute instead of duplicating', async () => {
    const { prisma } = createPrisma({
      disputes: [{ id: 'existing', status: 'PENDING', matchId, discordUserId: userId, reason: '' }],
    });

    const result = await new MatchResultDisputeService(prisma).createDispute(
      matchId,
      userId,
      'Another reason',
      'corr-2',
    );

    expect(result.status).toBe('already_pending');
    expect(result.id).toBe('existing');
  });

  it('lists pending disputes for a guild', async () => {
    const { prisma } = createPrisma({
      disputes: [{ id: 'existing', status: 'PENDING', matchId, discordUserId: userId, reason: '' }],
    });

    const disputes = await new MatchResultDisputeService(prisma).listPending(guildId);

    expect(disputes).toHaveLength(1);
    expect(disputes[0]?.id).toBe('existing');
  });

  it('rejects a dispute without reversing result', async () => {
    const { prisma, disputes } = createPrisma({
      disputes: [{ id: 'd1', status: 'PENDING', matchId, discordUserId: userId, reason: '' }],
    });

    await new MatchResultDisputeService(prisma).resolveDispute(
      'd1',
      'REJECT',
      'Not enough evidence',
      'staff-1',
      'corr-3',
    );

    expect(disputes[0]?.status).toBe('REJECTED');
  });

  it('reverses a result when resolving with REVERSE', async () => {
    const { prisma, disputes } = createPrisma({
      disputes: [{ id: 'd1', status: 'PENDING', matchId, discordUserId: userId, reason: '' }],
      ratingChanges: [{ id: 'rc1', discordUserId: 'p1', delta: 25, reversedAt: null }],
    });

    await new MatchResultDisputeService(prisma).resolveDispute(
      'd1',
      'REVERSE',
      'Confirmed wrong score',
      'staff-1',
      'corr-4',
    );

    expect(prisma.playerGuildStats.update).toHaveBeenCalled();
    expect(prisma.matchRatingChange.updateMany).toHaveBeenCalled();
    expect(disputes[0]?.status).toBe('RESOLVED');
  });
});
