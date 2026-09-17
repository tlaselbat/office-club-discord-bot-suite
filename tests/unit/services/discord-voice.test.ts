import { describe, expect, it, vi } from 'vitest';
import { DiscordVoiceAdapter } from '../../../src/modules/tenman/services/discord-voice.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

function createMockPrisma(overrides: object = {}): PrismaClient {
  return {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'match-1',
        guildId: 'guild-1',
        state: 'LIVE',
        guild: {
          lobbyVoiceChannelId: 'lobby',
          team1VoiceChannelId: 'team1',
          team2VoiceChannelId: 'team2',
        },
        players: [
          { discordUserId: 'p1', team: 'TEAM_1' },
          { discordUserId: 'p2', team: 'TEAM_2' },
        ],
        ...overrides,
      }),
    },
  } as unknown as PrismaClient;
}

function createMockClient(
  members: Map<
    string,
    { voice: { channelId: string | null; setChannel: ReturnType<typeof vi.fn> } }
  >,
) {
  return {
    guilds: {
      cache: {
        get: () => ({
          members: {
            fetch: async (id: string) => {
              const member = members.get(id);
              if (member === undefined) throw new Error('not found');
              return member;
            },
          },
        }),
      },
    },
  };
}

describe('DiscordVoiceAdapter', () => {
  it('moves participants to team channels', async () => {
    const members = new Map([
      ['p1', { voice: { channelId: 'lobby', setChannel: vi.fn().mockResolvedValue(undefined) } }],
      ['p2', { voice: { channelId: 'lobby', setChannel: vi.fn().mockResolvedValue(undefined) } }],
    ]);
    const prisma = createMockPrisma();
    const client = createMockClient(members);
    const adapter = new DiscordVoiceAdapter(
      prisma,
      client as unknown as ConstructorParameters<typeof DiscordVoiceAdapter>[1],
    );

    await adapter.reconcileMatchVoice('match-1');

    expect(members.get('p1')?.voice.setChannel).toHaveBeenCalledWith('team1');
    expect(members.get('p2')?.voice.setChannel).toHaveBeenCalledWith('team2');
  });

  it('returns participants to lobby on finish', async () => {
    const members = new Map([
      ['p1', { voice: { channelId: 'team1', setChannel: vi.fn().mockResolvedValue(undefined) } }],
      ['p2', { voice: { channelId: 'team2', setChannel: vi.fn().mockResolvedValue(undefined) } }],
    ]);
    const prisma = createMockPrisma({ state: 'FINISHED' });
    const client = createMockClient(members);
    const adapter = new DiscordVoiceAdapter(
      prisma,
      client as unknown as ConstructorParameters<typeof DiscordVoiceAdapter>[1],
    );

    await adapter.returnParticipantsToLobby('match-1');

    expect(members.get('p1')?.voice.setChannel).toHaveBeenCalledWith('lobby');
    expect(members.get('p2')?.voice.setChannel).toHaveBeenCalledWith('lobby');
  });

  it('survives per-member fetch failures', async () => {
    const members = new Map([
      ['p1', { voice: { channelId: 'lobby', setChannel: vi.fn().mockResolvedValue(undefined) } }],
    ]);
    const prisma = createMockPrisma();
    const client = createMockClient(members);
    const adapter = new DiscordVoiceAdapter(
      prisma,
      client as unknown as ConstructorParameters<typeof DiscordVoiceAdapter>[1],
    );

    await expect(adapter.reconcileMatchVoice('match-1')).resolves.not.toThrow();
  });
});
