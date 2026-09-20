import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { PartyService } from '../../../src/modules/tenman/services/party-service.js';

const party = {
  id: 'party-1',
  guildId: 'guild-1',
  leaderDiscordUserId: 'leader-1',
  members: [{ discordUserId: 'leader-1' }, { discordUserId: 'member-1' }],
};

function createPrisma(): { prisma: PrismaClient; transaction: Record<string, unknown> } {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({ v2Enabled: true, partyEnabled: true }),
    },
    tenManQueueEntry: { findFirst: vi.fn().mockResolvedValue(null) },
    tenManParty: {
      create: vi.fn().mockResolvedValue({ id: party.id }),
      findUnique: vi.fn().mockResolvedValue(party),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    tenManPartyMember: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    tenManPartyInvite: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: 'invite-1',
        partyId: party.id,
        inviteeDiscordUserId: 'invitee-1',
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: null,
        revokedAt: null,
        party,
      }),
      create: vi.fn().mockResolvedValue({ id: 'invite-1' }),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient,
    transaction: transaction as Record<string, unknown>,
  };
}

describe('PartyService', () => {
  it('creates a durable, recipient-bound invitation under the guild lock', async () => {
    const { prisma, transaction } = createPrisma();

    await expect(new PartyService(prisma).invite(party.id, 'leader-1', 'invitee-1')).resolves.toBe(
      'invite-1',
    );

    expect(transaction.$executeRaw as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(
      (transaction.tenManPartyInvite as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partyId: party.id,
          inviteeDiscordUserId: 'invitee-1',
          inviterDiscordUserId: 'leader-1',
        }),
      }),
    );
  });

  it('accepts an active invitation once and records its acceptance', async () => {
    const { prisma, transaction } = createPrisma();

    await new PartyService(prisma).accept('invite-1', 'invitee-1');

    expect(
      (transaction.tenManPartyMember as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledWith({
      data: { partyId: party.id, discordUserId: 'invitee-1' },
    });
    expect(
      (transaction.tenManPartyInvite as { update: ReturnType<typeof vi.fn> }).update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acceptedAt: expect.any(Date) }) }),
    );
  });

  it('refuses any party mutation while a party member is queued', async () => {
    const { prisma, transaction } = createPrisma();
    (
      transaction.tenManQueueEntry as { findFirst: ReturnType<typeof vi.fn> }
    ).findFirst.mockResolvedValue({
      id: 'queue-entry-1',
    });

    await expect(
      new PartyService(prisma).kick(party.id, 'leader-1', 'member-1'),
    ).rejects.toMatchObject({
      code: 'PARTY_QUEUED',
    });
    expect(
      (transaction.tenManPartyMember as { delete: ReturnType<typeof vi.fn> }).delete,
    ).not.toHaveBeenCalled();
  });

  it('preserves leader ownership by requiring a leader to disband', async () => {
    const { prisma } = createPrisma();

    await expect(new PartyService(prisma).leave(party.id, 'leader-1')).rejects.toMatchObject({
      code: 'PARTY_LEADER_CANNOT_LEAVE',
    });
  });

  it('disbands a non-queued party only when requested by its leader', async () => {
    const { prisma, transaction } = createPrisma();

    await new PartyService(prisma).disband(party.id, 'leader-1');

    expect(
      (transaction.tenManParty as { delete: ReturnType<typeof vi.fn> }).delete,
    ).toHaveBeenCalledWith({
      where: { id: party.id },
    });
  });
});
