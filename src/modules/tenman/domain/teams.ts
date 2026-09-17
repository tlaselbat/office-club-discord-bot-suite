import { randomInt } from 'node:crypto';

export type PlayerTeam = 'TEAM_1' | 'TEAM_2' | 'SPECTATOR' | 'UNASSIGNED';

export interface TeamPlayer {
  discordUserId: string;
  steamId64: string;
}

export interface TeamAssignment {
  team1: readonly TeamPlayer[];
  team2: readonly TeamPlayer[];
}

export interface TeamBalancer {
  generate(players: readonly TeamPlayer[]): TeamAssignment;
}

export class RandomTeamBalancer implements TeamBalancer {
  public generate(players: readonly TeamPlayer[]): TeamAssignment {
    if (players.length === 0 || players.length % 2 !== 0) {
      throw new Error('An even, non-zero player count is required');
    }
    const seenDiscord = new Set(players.map((player) => player.discordUserId));
    const seenSteam = new Set(players.map((player) => player.steamId64));
    if (seenDiscord.size !== players.length || seenSteam.size !== players.length) {
      throw new Error('Players must have unique Discord and Steam identities');
    }
    const shuffled = [...players];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      const current = shuffled[index];
      const target = shuffled[swapIndex];
      if (current === undefined || target === undefined) throw new Error('Invalid shuffle index');
      shuffled[index] = target;
      shuffled[swapIndex] = current;
    }
    const midpoint = shuffled.length / 2;
    return { team1: shuffled.slice(0, midpoint), team2: shuffled.slice(midpoint) };
  }
}

export function validateLockedTeams(
  players: readonly (TeamPlayer & { team: PlayerTeam })[],
  playersPerTeam: number,
): void {
  const team1 = players.filter((player) => player.team === 'TEAM_1');
  const team2 = players.filter((player) => player.team === 'TEAM_2');
  if (
    players.length !== playersPerTeam * 2 ||
    team1.length !== playersPerTeam ||
    team2.length !== playersPerTeam
  ) {
    throw new Error(`Locked roster requires exactly ${String(playersPerTeam)} players per team`);
  }
  if (new Set(players.map((player) => player.discordUserId)).size !== players.length) {
    throw new Error('Duplicate Discord participant');
  }
  if (new Set(players.map((player) => player.steamId64)).size !== players.length) {
    throw new Error('Duplicate Steam participant');
  }
}
