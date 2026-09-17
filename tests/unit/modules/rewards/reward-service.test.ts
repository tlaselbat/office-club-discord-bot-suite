import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { RewardService } from '../../../../src/modules/rewards/services/reward-service.js';

function prismaWith(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaClient;
}

const command = {
  guildId: 'guild-1',
  discordUserId: 'user-1',
  displayName: 'Member',
  amount: 10,
  source: 'TEXT_ACTIVITY' as const,
  idempotencyKey: 'text:message-1',
  textCooldownSeconds: 60,
};

describe('RewardService', () => {
  it('creates one immutable ledger entry and updates the derived total and level', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      rewardSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
      rewardActivityReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      rewardLedgerEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
      rewardMember: {
        upsert: vi
          .fn()
          .mockResolvedValue({ effectiveXp: 95, currentLevel: 1, lastTextAwardAt: null }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      rewardLevel: { findFirst: vi.fn().mockResolvedValue({ level: 2 }) },
      user: { upsert: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new RewardService(prismaWith(transaction));

    await expect(service.award(command)).resolves.toEqual({
      applied: true,
      effectiveXp: 105,
      level: 2,
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
    expect(transaction.rewardLedgerEntry.create).toHaveBeenCalledOnce();
    expect(transaction.rewardMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ effectiveXp: 105, currentLevel: 2 }),
      }),
    );
  });

  it('rejects a different message inside the strict elapsed cooldown', async () => {
    const awardedAt = new Date('2026-09-17T12:00:30Z');
    const transaction = {
      $executeRaw: vi.fn(),
      rewardSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
      rewardActivityReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      rewardLedgerEntry: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      rewardMember: {
        upsert: vi.fn().mockResolvedValue({
          effectiveXp: 10,
          currentLevel: 0,
          lastTextAwardAt: new Date('2026-09-17T12:00:00Z'),
        }),
        update: vi.fn(),
      },
      user: { upsert: vi.fn() },
    };
    const service = new RewardService(prismaWith(transaction));

    await expect(
      service.award({ ...command, idempotencyKey: 'text:message-2', awardedAt }),
    ).resolves.toEqual({ applied: false, effectiveXp: 10, level: 0 });
    expect(transaction.rewardLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('returns the existing result for a repeated idempotency key', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      rewardActivityReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      rewardLedgerEntry: { findUnique: vi.fn().mockResolvedValue({ discordUserId: 'user-1' }) },
      rewardMember: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ effectiveXp: 10, currentLevel: 0 }),
      },
    };
    const service = new RewardService(prismaWith(transaction));

    await expect(service.award(command)).resolves.toEqual({
      applied: false,
      effectiveXp: 10,
      level: 0,
    });
  });

  it('floors effective XP at zero while retaining the signed adjustment', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      rewardSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
      rewardActivityReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      rewardLedgerEntry: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      rewardMember: {
        upsert: vi
          .fn()
          .mockResolvedValue({ effectiveXp: 5, currentLevel: 0, lastTextAwardAt: null }),
        update: vi.fn(),
      },
      rewardLevel: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { upsert: vi.fn() },
      auditEvent: { create: vi.fn() },
      job: { upsert: vi.fn() },
    };
    const service = new RewardService(prismaWith(transaction));

    await expect(
      service.award({
        ...command,
        amount: -20,
        source: 'ADMIN_ADJUSTMENT',
        idempotencyKey: 'admin:adjustment-1',
        actorDiscordUserId: 'admin-1',
        reason: 'Rule violation',
        correlationId: 'adjustment-1',
      }),
    ).resolves.toEqual({ applied: true, effectiveXp: 0, level: 0 });
    expect(transaction.rewardLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: -20 }) }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledOnce();
    expect(transaction.job.upsert).toHaveBeenCalledOnce();
  });

  it('requires actor and reason for manual adjustments', async () => {
    const service = new RewardService(prismaWith({}));
    await expect(service.award({ ...command, source: 'ADMIN_ADJUSTMENT' })).rejects.toThrow(
      'Admin adjustment actor required',
    );
  });
});
