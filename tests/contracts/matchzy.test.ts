import { describe, expect, it } from 'vitest';
import { buildMatchZyConfig } from '../../src/modules/tenman/integrations/matchzy/config-builder.js';
import { renderMatchZyCommand } from '../../src/modules/tenman/integrations/matchzy/commands.js';
import { matchzyEventSchema } from '../../src/modules/tenman/integrations/matchzy/schemas.js';

const players = Array.from({ length: 10 }, (_, index) => ({
  steamId64: String(76561197960265728n + BigInt(index)),
  displayName: `Player ${String(index + 1)}`,
  team: index < 5 ? ('TEAM_1' as const) : ('TEAM_2' as const),
}));

describe('MatchZy 0.8.15 contract', () => {
  it('builds an exact immutable 5v5 config', () => {
    const built = buildMatchZyConfig({
      matchId: 42,
      mapName: 'de_mirage',
      playersPerTeam: 5,
      team1Name: 'Team 1',
      team2Name: 'Team 2',
      players,
      minPlayersToReady: 10,
      mapSide: 'knife',
      cvars: {},
      remoteLogUrl: 'https://bot.example.com/webhooks/matchzy/id',
      remoteLogHeaderKey: 'X-MatchZy-Token',
      remoteLogHeaderValue: 'a-secure-event-token',
    });
    expect(Object.keys(built.config.team1.players)).toHaveLength(5);
    expect(built.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('honors the selected profile-side and wingman settings', () => {
    const built = buildMatchZyConfig({
      matchId: 43,
      mapName: 'de_inferno',
      playersPerTeam: 2,
      team1Name: 'Team 1',
      team2Name: 'Team 2',
      players: players.slice(0, 2).concat(players.slice(5, 7)),
      minPlayersToReady: 4,
      mapSide: 'team1_ct',
      wingman: true,
      cvars: {},
      remoteLogUrl: 'https://bot.example.com/webhooks/matchzy/id',
      remoteLogHeaderKey: 'X-MatchZy-Token',
      remoteLogHeaderValue: 'a-secure-event-token',
    });
    expect(built.config.map_sides).toEqual(['team1_ct']);
    expect(built.config.wingman).toBe(true);
  });

  it('parses the pinned series_end event shape', () => {
    expect(
      matchzyEventSchema.parse({
        event: 'series_end',
        matchid: 42,
        team1_series_score: 1,
        team2_series_score: 0,
        winner: { side: 'ct', team: 'team1' },
        time_until_restore: 45,
      }).event,
    ).toBe('series_end');
  });

  it('renders only semantic allowlisted commands', () => {
    expect(renderMatchZyCommand({ type: 'FORCE_PAUSE' })).toBe('css_forcepause');
    expect(() =>
      renderMatchZyCommand({
        type: 'LOAD_MATCH',
        url: 'https://bot.example.com/config\nquit',
        headerName: 'Authorization',
        headerValue: 'token',
      }),
    ).toThrow();
  });
});
