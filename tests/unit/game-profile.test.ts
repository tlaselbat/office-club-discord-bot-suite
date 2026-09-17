import { describe, expect, it } from 'vitest';
import { gameProfileSchema } from '../../src/modules/tenman/domain/game-profile.js';

const profile = {
  key: 'competitive_5v5',
  enabled: true,
  playersPerTeam: 5,
  numMaps: 1,
  serverSlots: 11,
  mapAllowlist: ['de_mirage'],
  matchzy: {
    minPlayersToReady: 10,
    knifeRound: true,
    mapSide: 'knife' as const,
    cvars: { mp_team_timeout_max: '3' },
  },
};

describe('game profile validation', () => {
  it('accepts the initial competitive profile', () => {
    expect(gameProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects too few slots and arbitrary map names', () => {
    expect(gameProfileSchema.safeParse({ ...profile, serverSlots: 10 }).success).toBe(false);
    expect(gameProfileSchema.safeParse({ ...profile, mapAllowlist: ['; quit'] }).success).toBe(
      false,
    );
  });
});
