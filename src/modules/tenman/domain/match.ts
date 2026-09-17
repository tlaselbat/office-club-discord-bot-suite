import { randomUUID } from 'node:crypto';
import { transitionMatch, type CleanupStatus, type MatchState } from './match-state.js';
import { validateLockedTeams, type PlayerTeam, type TeamPlayer } from './teams.js';

export interface MatchPlayer extends TeamPlayer {
  displayName: string;
  team: PlayerTeam;
  ready: boolean;
}

export interface MatchSnapshot {
  id: string;
  guildId: string;
  leaderDiscordUserId: string;
  state: MatchState;
  cleanupStatus: CleanupStatus;
  profileKey: string;
  selectedMap?: string;
  players: readonly MatchPlayer[];
  version: number;
}

export class MatchAggregate {
  private constructor(private snapshot: MatchSnapshot) {}

  public static create(
    guildId: string,
    leaderDiscordUserId: string,
    profileKey: string,
  ): MatchAggregate {
    return new MatchAggregate({
      id: randomUUID(),
      guildId,
      leaderDiscordUserId,
      state: 'CREATED',
      cleanupStatus: 'NOT_REQUIRED',
      profileKey,
      players: [],
      version: 0,
    });
  }

  public static restore(snapshot: MatchSnapshot): MatchAggregate {
    return new MatchAggregate(structuredClone(snapshot));
  }

  public get value(): MatchSnapshot {
    return structuredClone(this.snapshot);
  }

  public transition(to: MatchState): void {
    this.snapshot = {
      ...this.snapshot,
      state: transitionMatch(this.snapshot.state, to),
      version: this.snapshot.version + 1,
    };
  }

  public addPlayer(player: Omit<MatchPlayer, 'team' | 'ready'>, capacity: number): void {
    if (this.snapshot.state !== 'OPEN') throw new Error('Match is not open');
    if (this.snapshot.players.length >= capacity) throw new Error('Match is full');
    if (this.snapshot.players.some((current) => current.discordUserId === player.discordUserId)) {
      throw new Error('Discord user already joined');
    }
    if (this.snapshot.players.some((current) => current.steamId64 === player.steamId64)) {
      throw new Error('Steam account already joined');
    }
    const players = [
      ...this.snapshot.players,
      { ...player, team: 'UNASSIGNED' as const, ready: false },
    ];
    this.snapshot = { ...this.snapshot, players, version: this.snapshot.version + 1 };
    if (players.length === capacity) this.transition('FULL');
  }

  public assignTeam(discordUserId: string, team: Exclude<PlayerTeam, 'SPECTATOR'>): void {
    if (!['FULL', 'TEAM_SETUP'].includes(this.snapshot.state))
      throw new Error('Teams cannot be changed');
    const players = this.snapshot.players.map((player) =>
      player.discordUserId === discordUserId ? { ...player, team } : player,
    );
    if (!players.some((player) => player.discordUserId === discordUserId))
      throw new Error('Player not found');
    this.snapshot = { ...this.snapshot, players, version: this.snapshot.version + 1 };
  }

  public selectMap(mapName: string, allowedMaps: readonly string[]): void {
    if (!['FULL', 'TEAM_SETUP'].includes(this.snapshot.state))
      throw new Error('Map cannot be changed');
    if (!allowedMaps.includes(mapName)) throw new Error('Map is not allowed by the profile');
    this.snapshot = { ...this.snapshot, selectedMap: mapName, version: this.snapshot.version + 1 };
  }

  public lockTeams(playersPerTeam: number): void {
    if (this.snapshot.selectedMap === undefined) throw new Error('A map must be selected');
    validateLockedTeams(this.snapshot.players, playersPerTeam);
    if (this.snapshot.state === 'FULL') this.transition('TEAM_SETUP');
    this.transition('TEAMS_LOCKED');
  }
}
