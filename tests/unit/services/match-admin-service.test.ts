import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { MatchAdminService } from '../../../src/modules/tenman/services/match-admin-service.js';

const baseMatch = {
  id: 'match-1',
  guildId: 'guild-1',
  state: 'READY_CHECK',
  version: 4,
  readyTimeoutSeconds: 90,
  players: [
    { discordUserId: 'outgoing', steamId64: 'steam-old', readyState: 'READY' },
    { discordUserId: 'other', steamId64: 'steam-other', readyState: 'NOT_READY' },
  ],
};

function createPrisma(match: object | null = baseMatch) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    match: {
      findUnique: vi.fn().mockResolvedValue(match),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    matchPlayer: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      delete: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
    },
    matchDraftPick: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    matchVetoAction: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    steamIdentity: { findFirst: vi.fn().mockResolvedValue({ steamId64: 'steam-new' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Replacement' }) },
    tenManQueueBan: { findFirst: vi.fn().mockResolvedValue(null) },
    playerGuildStats: { upsert: vi.fn().mockResolvedValue(undefined) },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    job: { upsert: vi.fn().mockResolvedValue(undefined) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient,
    transaction,
  };
}

describe('MatchAdminService', () => {
  it('force-ready advances a ready check and schedules a version-bound phase timeout', async () => {
    const { prisma, transaction } = createPrisma();

    await new MatchAdminService(prisma).forceReady('match-1', 4, 'admin', 'corr-1');

    expect(transaction.matchPlayer.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match-1', readyState: { not: 'READY' } },
      data: { readyState: 'READY' },
    });
    expect(transaction.match.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 'READY_CHECK', version: 4 }),
        data: expect.objectContaining({ state: 'TEAM_SELECTION', version: { increment: 1 } }),
      }),
    );
    expect(transaction.matchStateTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'ADMIN_FORCE_READY' }) }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'admin_force_ready' }),
      }),
    );
  });

  it('replaces a ready-check participant with a verified, unbanned identity and invalidates controls', async () => {
    const { prisma, transaction } = createPrisma();

    await new MatchAdminService(prisma).replaceParticipant({
      matchId: 'match-1',
      outgoingDiscordUserId: 'outgoing',
      incomingDiscordUserId: 'incoming',
      expectedVersion: 4,
      actorDiscordUserId: 'admin',
      correlationId: 'corr-2',
    });

    expect(transaction.matchPlayer.delete).toHaveBeenCalledWith({
      where: { matchId_discordUserId: { matchId: 'match-1', discordUserId: 'outgoing' } },
    });
    expect(transaction.matchPlayer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        discordUserId: 'incoming',
        steamId64: 'steam-new',
        readyState: 'NOT_READY',
      }),
    });
    expect(transaction.job.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'phase-timeout:match-1:READY_CHECK:5' },
      }),
    );
  });

  it('restarts a team-selection phase by clearing durable picks and captain assignments', async () => {
    const teamMatch = { ...baseMatch, state: 'TEAM_SELECTION' };
    const { prisma, transaction } = createPrisma(teamMatch);

    await new MatchAdminService(prisma).restartFormingPhase('match-1', 4, 'admin', 'corr-3');

    expect(transaction.matchDraftPick.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
    });
    expect(transaction.matchPlayer.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      data: { captainTeam: null, team: 'UNASSIGNED', draftOrder: null },
    });
    expect(transaction.matchStateTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromState: 'TEAM_SELECTION', toState: 'TEAM_SELECTION' }),
      }),
    );
  });

  it('resets only the current guild standings and retains historical records', async () => {
    const { prisma, transaction } = createPrisma();

    await new MatchAdminService(prisma).resetPlayerStats('guild-1', 'incoming', 'admin', 'corr-4');

    expect(transaction.playerGuildStats.upsert).toHaveBeenCalledWith({
      where: { guildId_discordUserId: { guildId: 'guild-1', discordUserId: 'incoming' } },
      update: { rating: 1000, wins: 0, losses: 0, matchesPlayed: 0 },
      create: { guildId: 'guild-1', discordUserId: 'incoming', rating: 1000 },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'admin_player_stats_reset' }),
      }),
    );
  });
});
