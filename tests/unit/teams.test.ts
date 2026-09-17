import { describe, expect, it } from 'vitest';
import { RandomTeamBalancer, validateLockedTeams } from '../../src/modules/tenman/domain/teams.js';

const players = Array.from({ length: 10 }, (_, index) => ({
  discordUserId: String(1000 + index),
  steamId64: String(76561197960265728n + BigInt(index)),
}));

describe('team invariants', () => {
  it('randomizes every player into equal teams exactly once', () => {
    const assignment = new RandomTeamBalancer().generate(players);
    expect(assignment.team1).toHaveLength(5);
    expect(assignment.team2).toHaveLength(5);
    expect(new Set([...assignment.team1, ...assignment.team2])).toHaveProperty('size', 10);
  });

  it('validates an exact locked 5v5 roster', () => {
    expect(() =>
      validateLockedTeams(
        players.map((player, index) => ({ ...player, team: index < 5 ? 'TEAM_1' : 'TEAM_2' })),
        5,
      ),
    ).not.toThrow();
  });

  it('rejects duplicate Steam identities', () => {
    const firstPlayer = players[0];
    if (firstPlayer === undefined) throw new Error('Missing fixture');
    const invalid = players.map((player, index) => ({
      ...player,
      steamId64: index === 9 ? firstPlayer.steamId64 : player.steamId64,
      team: index < 5 ? ('TEAM_1' as const) : ('TEAM_2' as const),
    }));
    expect(() => validateLockedTeams(invalid, 5)).toThrow('Duplicate Steam participant');
  });
});
