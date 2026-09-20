import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { MatchService } from '../../../src/modules/tenman/services/match-service.js';

function createPrisma() {
  const transaction = {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'match-1',
        guildId: 'guild-1',
        state: 'TEAM_SELECTION',
        dathostServerId: null,
        cleanupStatus: 'NOT_REQUIRED',
        leaderDiscordUserId: 'leader-1',
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    job: { upsert: vi.fn().mockResolvedValue(undefined) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

const administrator = {
  discordUserId: 'admin-1',
  isParticipant: false,
  isPrivilegedMember: false,
  isModerator: false,
  isAdministrator: true,
};

describe('MatchService cancellation', () => {
  it('routes an unprovisioned match through cleanup to release owned resources and queue', async () => {
    const { prisma, transaction } = createPrisma();

    await new MatchService(prisma).cancel('match-1', administrator, 'corr-1');

    expect(transaction.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cleanupStatus: 'PENDING', guildSlotActive: true }),
      }),
    );
    expect(transaction.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type: 'CLEANUP_MATCH' }) }),
    );
  });
});
