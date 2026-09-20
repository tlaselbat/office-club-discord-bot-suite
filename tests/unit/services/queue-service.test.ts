import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { QueueService } from '../../../src/modules/tenman/services/queue-service.js';

const guildId = 'guild-1';
const leaderId = 'leader-1';
const memberId = 'member-1';

function createPrisma(options?: {
  party?: boolean;
  identities?: Array<{ discordUserId: string; steamId64: string }>;
}) {
  const party = options?.party
    ? {
        partyId: 'party-1',
        party: {
          id: 'party-1',
          guildId,
          leaderDiscordUserId: leaderId,
          members: [
            { discordUserId: leaderId, user: { displayName: 'Leader' } },
            { discordUserId: memberId, user: { displayName: 'Member' } },
          ],
        },
      }
    : null;
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({
        enabled: true,
        v2Enabled: true,
        partyEnabled: true,
        defaultGameProfileKey: 'cs2-5v5',
        queueSize: 10,
        readyTimeoutSeconds: 90,
      }),
    },
    gameProfile: { findUnique: vi.fn().mockResolvedValue({ playersPerTeam: 5 }) },
    match: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    tenManPartyMember: { findUnique: vi.fn().mockResolvedValue(party) },
    steamIdentity: {
      findMany: vi.fn().mockResolvedValue(
        options?.identities ?? [
          { discordUserId: leaderId, steamId64: '76561198000000001' },
          { discordUserId: memberId, steamId64: '76561198000000002' },
        ],
      ),
    },
    tenManQueueBan: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { upsert: vi.fn().mockResolvedValue(undefined) },
    tenManQueue: {
      upsert: vi.fn().mockResolvedValue({ status: 'OPEN' }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    tenManQueueEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 10 }),
    },
    job: { upsert: vi.fn().mockResolvedValue(undefined), create: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    matchStateTransition: { create: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient,
    transaction,
  };
}

describe('QueueService party joins', () => {
  it('inserts every party member with the shared party id in one createMany call', async () => {
    const { prisma, transaction } = createPrisma({ party: true });

    await new QueueService(prisma).join({
      guildId,
      discordUserId: leaderId,
      displayName: 'Leader live',
      correlationId: 'corr-1',
    });

    expect(transaction.tenManQueueEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          discordUserId: leaderId,
          steamId64: '76561198000000001',
          displayNameSnapshot: 'Leader live',
          partyId: 'party-1',
        }),
        expect.objectContaining({
          discordUserId: memberId,
          steamId64: '76561198000000002',
          displayNameSnapshot: 'Member',
          partyId: 'party-1',
        }),
      ]),
    });
    expect(transaction.tenManQueueEntry.createMany).toHaveBeenCalledTimes(1);
  });

  it('does not insert any party member when one lacks a verified Steam identity', async () => {
    const { prisma, transaction } = createPrisma({
      party: true,
      identities: [{ discordUserId: leaderId, steamId64: '76561198000000001' }],
    });

    await expect(
      new QueueService(prisma).join({
        guildId,
        discordUserId: leaderId,
        displayName: 'Leader live',
        correlationId: 'corr-2',
      }),
    ).rejects.toMatchObject({ code: 'STEAM_REQUIRED' });

    expect(transaction.tenManQueueEntry.createMany).not.toHaveBeenCalled();
  });

  it('preserves an individual join without a party id', async () => {
    const { prisma, transaction } = createPrisma({
      identities: [{ discordUserId: leaderId, steamId64: '76561198000000001' }],
    });

    await new QueueService(prisma).join({
      guildId,
      discordUserId: leaderId,
      displayName: 'Leader live',
      correlationId: 'corr-3',
    });

    expect(transaction.tenManQueueEntry.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          discordUserId: leaderId,
          displayNameSnapshot: 'Leader live',
          partyId: null,
        }),
      ],
    });
  });

  it('promotes normally when an atomic party join fills the final queue slots', async () => {
    const { prisma, transaction } = createPrisma({ party: true });
    const otherEntries = Array.from({ length: 8 }, (_, index) => ({
      discordUserId: `other-${String(index)}`,
      steamId64: `765611980000000${String(index + 10).padStart(2, '0')}`,
      displayNameSnapshot: `Other ${String(index)}`,
    }));
    const partyEntries = [
      {
        discordUserId: leaderId,
        steamId64: '76561198000000001',
        displayNameSnapshot: 'Leader live',
      },
      { discordUserId: memberId, steamId64: '76561198000000002', displayNameSnapshot: 'Member' },
    ];
    transaction.tenManQueueEntry.count.mockResolvedValue(8);
    transaction.tenManQueueEntry.findMany.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        'discordUserId' in args.where ? [] : [...otherEntries, ...partyEntries],
    );
    transaction.match.create.mockResolvedValue({ id: 'match-1', version: 0 });

    await expect(
      new QueueService(prisma).join({
        guildId,
        discordUserId: leaderId,
        displayName: 'Leader live',
        correlationId: 'corr-4',
      }),
    ).resolves.toEqual({ promotedMatchId: 'match-1' });

    expect(transaction.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          players: { create: expect.arrayContaining(partyEntries) },
        }),
      }),
    );
    expect(transaction.tenManQueueEntry.deleteMany).toHaveBeenCalledWith({ where: { guildId } });
  });
});
