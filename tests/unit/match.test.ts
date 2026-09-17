import { describe, expect, it } from 'vitest';
import { MatchAggregate } from '../../src/modules/tenman/domain/match.js';

const players = Array.from({ length: 10 }, (_, index) => ({
  discordUserId: String(1000 + index),
  steamId64: String(76561197960265728n + BigInt(index)),
  displayName: `Player ${String(index + 1)}`,
}));

describe('match aggregate', () => {
  it('fills, organizes, selects a permitted map, and locks a 5v5', () => {
    const match = MatchAggregate.create('guild', '1000', 'competitive_5v5');
    match.transition('OPEN');
    for (const player of players) match.addPlayer(player, 10);
    expect(match.value.state).toBe('FULL');
    for (const [index, player] of players.entries()) {
      match.assignTeam(player.discordUserId, index < 5 ? 'TEAM_1' : 'TEAM_2');
    }
    match.selectMap('de_mirage', ['de_mirage']);
    match.lockTeams(5);
    expect(match.value.state).toBe('TEAMS_LOCKED');
  });

  it('rejects duplicate Steam identities', () => {
    const match = MatchAggregate.create('guild', '1000', 'competitive_5v5');
    match.transition('OPEN');
    const first = players[0];
    const second = players[1];
    if (first === undefined || second === undefined) throw new Error('Missing fixtures');
    match.addPlayer(first, 10);
    expect(() => match.addPlayer({ ...second, steamId64: first.steamId64 }, 10)).toThrow(
      'Steam account already joined',
    );
  });
});
