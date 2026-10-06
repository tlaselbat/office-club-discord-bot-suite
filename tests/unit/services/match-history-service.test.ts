import { describe, expect, it, vi } from 'vitest';
import { MatchHistoryService } from '../../../src/modules/tenman/services/match-history-service.js';

function setup(statsResetAt: Date | null) {
  const transaction = {
    $executeRaw: vi.fn(),
    match: {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', guildId: 'g1', resultStatus: 'APPLIED' }),
      update: vi.fn(),
    },
    matchRatingChange: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ discordUserId: 'u1', delta: 25, createdAt: new Date('2026-01-01') }]),
      updateMany: vi.fn(),
    },
    playerGuildStats: {
      findUnique: vi.fn().mockResolvedValue({ statsResetAt }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  return { transaction, prisma };
}

describe('MatchHistoryService rollback result reset boundary', () => {
  it('marks a pre-reset result reversed without changing the new baseline', async () => {
    const { prisma, transaction } = setup(new Date('2026-02-01'));
    await new MatchHistoryService(prisma as never).rollbackResult('m1', 'admin', 'c1');
    expect(transaction.playerGuildStats.update).not.toHaveBeenCalled();
    expect(transaction.matchRatingChange.updateMany).toHaveBeenCalled();
  });

  it('reverses a result created after the latest reset', async () => {
    const { prisma, transaction } = setup(new Date('2025-12-01'));
    await new MatchHistoryService(prisma as never).rollbackResult('m1', 'admin', 'c1');
    expect(transaction.playerGuildStats.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          rating: { decrement: 25 },
          wins: { decrement: 1 },
          losses: { decrement: 0 },
          matchesPlayed: { decrement: 1 },
        },
      }),
    );
  });

  it.each([
    ['win', 25, { rating: 1025, wins: 1, losses: 0, matchesPlayed: 1 }],
    ['loss', -25, { rating: 975, wins: 0, losses: 1, matchesPlayed: 1 }],
  ])(
    'preserves exact post-reset aggregate arithmetic for a %s',
    async (_label, delta, expected) => {
      const aggregate = {
        rating: expected.rating,
        wins: expected.wins,
        losses: expected.losses,
        matchesPlayed: expected.matchesPlayed,
      };
      const { prisma, transaction } = setup(new Date('2025-12-01'));
      transaction.matchRatingChange.findMany.mockResolvedValue([
        { discordUserId: 'u1', delta, createdAt: new Date('2026-01-01') },
      ]);
      transaction.playerGuildStats.updateMany.mockImplementation(
        async ({
          data,
        }: {
          data: {
            rating: { decrement: number };
            wins: { decrement: number };
            losses: { decrement: number };
            matchesPlayed: { decrement: number };
          };
        }) => {
          aggregate.rating -= data.rating.decrement;
          aggregate.wins -= data.wins.decrement;
          aggregate.losses -= data.losses.decrement;
          aggregate.matchesPlayed -= data.matchesPlayed.decrement;
          return { count: 1 };
        },
      );
      await new MatchHistoryService(prisma as never).rollbackResult('m1', 'admin', 'c1');
      expect(aggregate).toEqual({ rating: 1000, wins: 0, losses: 0, matchesPlayed: 0 });
    },
  );

  it('uses the newest reset boundary when multiple resets exist', async () => {
    const { prisma, transaction } = setup(new Date('2026-02-01'));
    transaction.matchRatingChange.findMany.mockResolvedValue([
      { discordUserId: 'u1', delta: 25, createdAt: new Date('2026-01-01') },
    ]);
    await new MatchHistoryService(prisma as never).rollbackResult('m1', 'admin', 'c1');
    expect(transaction.playerGuildStats.updateMany).not.toHaveBeenCalled();
  });
});
