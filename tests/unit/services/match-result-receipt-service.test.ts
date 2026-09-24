import { describe, expect, it, vi } from 'vitest';
import type { Client, TextChannel } from 'discord.js';
import { MatchResultReceiptService } from '../../../src/modules/tenman/services/match-result-receipt-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const guildId = '12345678901234567';
const matchId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const channelId = '98765432109876543';
const messageId = '11111111111111111';

function createMocks() {
  const send = vi.fn().mockResolvedValue({ id: messageId });
  const edit = vi.fn().mockResolvedValue({ id: messageId });
  const channel = {
    id: channelId,
    isTextBased: () => true,
    send,
    messages: { edit },
  } as unknown as TextChannel;
  const discord = {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as unknown as Client;

  type Resource = {
    id: string;
    matchId: string;
    resourceType: string;
    discordId: string | null;
    state: string;
  };
  const resources: Resource[] = [];
  const prisma = {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: matchId,
        state: 'FINISHED',
        result: {
          team1SeriesScore: 13,
          team2SeriesScore: 9,
          winner: { team: 'team1' },
        },
        selectedMap: 'de_mirage',
        guildId,
        guild: { resultsChannelId: channelId },
        players: [
          {
            discordUserId: 'p1',
            steamId64: '76561198000000001',
            team: 'TEAM_1',
            user: { displayName: 'Alice' },
          },
          {
            discordUserId: 'p2',
            steamId64: '76561198000000002',
            team: 'TEAM_2',
            user: { displayName: 'Bob' },
          },
        ],
        ratingChanges: [
          { discordUserId: 'p1', delta: 25, ratingAfter: 1025 },
          { discordUserId: 'p2', delta: -25, ratingAfter: 975 },
        ],
        demoReferences: [],
      }),
    },
    matchDiscordResource: {
      findFirst: vi
        .fn()
        .mockImplementation(({ where }: { where: { matchId?: string; resourceType?: string } }) => {
          const resource = resources.find(
            (r) => r.matchId === where.matchId && r.resourceType === where.resourceType,
          );
          return Promise.resolve(resource ?? null);
        }),
      upsert: vi
        .fn()
        .mockImplementation(
          ({ where, create }: { where: { id: string }; create: Omit<Resource, 'id'> }) => {
            const index = resources.findIndex((r) => r.id === where.id);
            if (index >= 0) {
              const existing = resources[index] as Resource;
              resources[index] = {
                id: existing.id,
                matchId: existing.matchId,
                resourceType: existing.resourceType,
                discordId: create.discordId,
                state: 'ACTIVE',
              };
            } else {
              resources.push({
                id: 'res-1',
                matchId: create.matchId,
                resourceType: create.resourceType,
                discordId: create.discordId,
                state: 'ACTIVE',
              });
            }
            return Promise.resolve({ id: 'res-1' });
          },
        ),
    },
  } as unknown as PrismaClient;

  return { prisma, discord, channel, resources, send, edit };
}

describe('MatchResultReceiptService', () => {
  it('posts a new receipt when none exists', async () => {
    const { prisma, discord, send } = createMocks();

    await new MatchResultReceiptService(prisma, discord).postReceipt(matchId);

    expect(send).toHaveBeenCalledTimes(1);
    const args = send.mock.calls[0] as [{ embeds: unknown[] }];
    expect(args[0].embeds).toHaveLength(1);
  });

  it('edits an existing receipt instead of duplicating', async () => {
    const { prisma, discord, resources, send, edit } = createMocks();
    resources.push({
      id: 'res-1',
      matchId,
      resourceType: 'MATCH_RESULT_RECEIPT',
      discordId: messageId,
      state: 'ACTIVE',
    });

    await new MatchResultReceiptService(prisma, discord).postReceipt(matchId);

    expect(edit).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips when no results channel is configured', async () => {
    const { prisma, discord } = createMocks();
    prisma.match.findUnique = vi.fn().mockResolvedValue({
      id: matchId,
      state: 'FINISHED',
      result: null,
      selectedMap: null,
      guildId,
      guild: { resultsChannelId: null },
      players: [],
      ratingChanges: [],
      demoReferences: [],
    });

    await new MatchResultReceiptService(prisma, discord).postReceipt(matchId);

    expect(discord.channels.fetch).not.toHaveBeenCalled();
  });

  it('skips non-terminal matches', async () => {
    const { prisma, discord } = createMocks();
    prisma.match.findUnique = vi.fn().mockResolvedValue({
      id: matchId,
      state: 'LIVE',
      result: null,
      selectedMap: null,
      guildId,
      guild: { resultsChannelId: channelId },
      players: [],
      ratingChanges: [],
      demoReferences: [],
    });

    await new MatchResultReceiptService(prisma, discord).postReceipt(matchId);

    expect(discord.channels.fetch).not.toHaveBeenCalled();
  });
});
