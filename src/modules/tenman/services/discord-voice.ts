import type { Client } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { CleanupVoice } from '../orchestrator/cleanup.js';
import { desiredLobbyMoves, desiredTeamVoiceMoves } from '../voice/reconciliation.js';

export class DiscordVoiceAdapter implements CleanupVoice {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
  ) {}

  public async returnParticipantsToLobby(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { players: true, guild: true },
    });
    if (match === null) throw new Error('Match not found');
    if (match.guild.lobbyVoiceChannelId === null) return;
    const guild = this.client.guilds.cache.get(match.guildId);
    if (guild === undefined) return;
    const participantIds = match.players.map((player) => player.discordUserId);
    const connected = await this.fetchConnectedChannels(guild, participantIds);
    const moves = desiredLobbyMoves(participantIds, connected, match.guild.lobbyVoiceChannelId);
    await this.executeMoves(moves, guild);
  }

  public async reconcileMatchVoice(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { players: true, guild: true },
    });
    if (match === null) throw new Error('Match not found');
    const teamStates = [
      'TEAMS_LOCKED',
      'SERVER_PROVISIONING',
      'SERVER_BOOTING',
      'SERVER_READY',
      'MATCH_LOADED',
      'WARMUP',
      'LIVE',
      'PAUSED',
    ];
    const terminalStates = ['FINISHED', 'CANCELED', 'FAILED'];
    if (!teamStates.includes(match.state) && !terminalStates.includes(match.state)) return;

    const guild = this.client.guilds.cache.get(match.guildId);
    if (guild === undefined) return;
    const participantIds = match.players.map((player) => player.discordUserId);
    const connected = await this.fetchConnectedChannels(guild, participantIds);

    if (terminalStates.includes(match.state) || match.state === 'TEAMS_LOCKED') {
      if (match.guild.lobbyVoiceChannelId === null) return;
      const moves = desiredLobbyMoves(participantIds, connected, match.guild.lobbyVoiceChannelId);
      await this.executeMoves(moves, guild);
      return;
    }

    if (
      match.guild.lobbyVoiceChannelId === null ||
      match.guild.team1VoiceChannelId === null ||
      match.guild.team2VoiceChannelId === null
    )
      return;

    const teamParticipants = match.players
      .filter((player) => player.team === 'TEAM_1' || player.team === 'TEAM_2')
      .map((player) => ({
        discordUserId: player.discordUserId,
        team: player.team as 'TEAM_1' | 'TEAM_2',
      }));
    const { moves } = desiredTeamVoiceMoves(teamParticipants, connected, {
      lobby: match.guild.lobbyVoiceChannelId,
      team1: match.guild.team1VoiceChannelId,
      team2: match.guild.team2VoiceChannelId,
    });
    await this.executeMoves(moves, guild);
  }

  private async fetchConnectedChannels(
    guild: {
      members: { fetch: (id: string) => Promise<{ voice?: { channelId?: string | null } | null }> };
    },
    participantIds: readonly string[],
  ): Promise<Map<string, string>> {
    const connected = new Map<string, string>();
    for (const discordUserId of participantIds) {
      try {
        const member = await guild.members.fetch(discordUserId);
        const channelId = member.voice?.channelId;
        if (typeof channelId === 'string') connected.set(discordUserId, channelId);
      } catch {
        // Member not available; treat as disconnected.
      }
    }
    return connected;
  }

  private async executeMoves(
    moves: readonly { discordUserId: string; destinationChannelId: string }[],
    guild: {
      members: {
        fetch: (id: string) => Promise<{ voice: { setChannel: (id: string) => Promise<unknown> } }>;
      };
    },
  ): Promise<void> {
    for (const { discordUserId, destinationChannelId } of moves) {
      try {
        const member = await guild.members.fetch(discordUserId);
        await member.voice.setChannel(destinationChannelId);
      } catch {
        // Per-user voice failures are not fatal.
      }
    }
  }
}
