import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { MatchParticipantInfoService } from '../../../src/modules/tenman/services/match-participant-info-service.js';

const matchId = '123e4567-e89b-12d3-a456-426614174000';

function match(overrides: object = {}) {
  return {
    guildId: 'guild-1',
    state: 'LIVE',
    cleanupStatus: 'NOT_REQUIRED',
    selectedMap: 'de_mirage',
    dathostServerId: 'server-1',
    dathostIp: '192.0.2.1',
    dathostPort: 27015,
    encryptedJoinPassword: 'encrypted-password',
    players: [{ team: 'TEAM_1' }],
    guild: { team1VoiceChannelId: 'voice-1', team2VoiceChannelId: 'voice-2' },
    ...overrides,
  };
}

describe('MatchParticipantInfoService', () => {
  it('authorizes a rostered player before decrypting and returns only join details', async () => {
    const prisma = {
      match: { findUnique: vi.fn().mockResolvedValue(match()) },
    } as unknown as PrismaClient;
    const cipher = { decrypt: vi.fn().mockReturnValue('join-password') };
    const result = await new MatchParticipantInfoService(prisma, cipher as never).get(
      matchId,
      'guild-1',
      'user-1',
    );

    expect(result).toEqual({
      team: 'TEAM_1',
      map: 'de_mirage',
      voiceChannelId: 'voice-1',
      address: '192.0.2.1:27015',
      password: 'join-password',
    });
    expect(cipher.decrypt).toHaveBeenCalledWith('encrypted-password', `join:${matchId}:server-1`);
  });

  it('does not decrypt for a non-participant or a cleanup-pending match', async () => {
    const prisma = {
      match: { findUnique: vi.fn().mockResolvedValue(match({ players: [] })) },
    } as unknown as PrismaClient;
    const cipher = { decrypt: vi.fn() };
    const service = new MatchParticipantInfoService(prisma, cipher as never);
    await expect(service.get(matchId, 'guild-1', 'user-1')).rejects.toThrow('Only assigned');
    expect(cipher.decrypt).not.toHaveBeenCalled();
  });
});
