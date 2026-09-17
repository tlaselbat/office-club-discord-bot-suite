import { createHash } from 'node:crypto';
import { matchzyConfigSchema, type MatchZyConfig } from './schemas.js';

export interface MatchZyRosterPlayer {
  steamId64: string;
  displayName: string;
  team: 'TEAM_1' | 'TEAM_2';
}

export interface MatchZyConfigInput {
  matchId: number;
  mapName: string;
  playersPerTeam: number;
  team1Name: string;
  team2Name: string;
  players: readonly MatchZyRosterPlayer[];
  minPlayersToReady: number;
  cvars: Readonly<Record<string, string>>;
  remoteLogUrl: string;
  remoteLogHeaderKey: string;
  remoteLogHeaderValue: string;
}

export interface BuiltMatchZyConfig {
  config: MatchZyConfig;
  canonicalJson: string;
  sha256: string;
}

export function buildMatchZyConfig(input: MatchZyConfigInput): BuiltMatchZyConfig {
  const playerMap = (team: MatchZyRosterPlayer['team']): Record<string, string> =>
    Object.fromEntries(
      input.players
        .filter((player) => player.team === team)
        .sort((left, right) => left.steamId64.localeCompare(right.steamId64))
        .map((player) => [player.steamId64, player.displayName]),
    );
  const config = matchzyConfigSchema.parse({
    matchid: input.matchId,
    team1: { name: input.team1Name, players: playerMap('TEAM_1') },
    team2: { name: input.team2Name, players: playerMap('TEAM_2') },
    num_maps: 1,
    maplist: [input.mapName],
    map_sides: ['knife'],
    players_per_team: input.playersPerTeam,
    min_players_to_ready: input.minPlayersToReady,
    cvars: input.cvars,
    remote_log_url: input.remoteLogUrl,
    remote_log_header_key: input.remoteLogHeaderKey,
    remote_log_header_value: input.remoteLogHeaderValue,
  });
  if (
    Object.keys(config.team1.players).length !== input.playersPerTeam ||
    Object.keys(config.team2.players).length !== input.playersPerTeam
  ) {
    throw new Error('MatchZy roster does not match profile team size');
  }
  const canonicalJson = JSON.stringify(config);
  return {
    config,
    canonicalJson,
    sha256: createHash('sha256').update(canonicalJson).digest('hex'),
  };
}
