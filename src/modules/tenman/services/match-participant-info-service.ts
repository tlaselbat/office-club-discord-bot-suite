import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { CredentialCipher } from './credential-cipher.js';

const JOINABLE_STATES = new Set(['SERVER_READY', 'MATCH_LOADED', 'WARMUP', 'LIVE', 'PAUSED']);

export interface MatchParticipantInfo {
  team: 'TEAM_1' | 'TEAM_2';
  map: string;
  voiceChannelId: string;
  address: string;
  password: string;
}

/**
 * Resolves a participant's private connection details. Authorization happens
 * before decrypting the password, and no caller receives operator credentials.
 */
export class MatchParticipantInfoService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: CredentialCipher,
  ) {}

  public async get(
    matchId: string,
    guildId: string,
    discordUserId: string,
  ): Promise<MatchParticipantInfo> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        guildId: true,
        state: true,
        cleanupStatus: true,
        selectedMap: true,
        dathostServerId: true,
        dathostIp: true,
        dathostPort: true,
        encryptedJoinPassword: true,
        players: {
          where: { discordUserId },
          select: { team: true },
        },
        guild: { select: { team1VoiceChannelId: true, team2VoiceChannelId: true } },
      },
    });
    if (match === null || match.guildId !== guildId)
      throw new Error('This match is not available in this server.');
    if (match.cleanupStatus !== 'NOT_REQUIRED' || !JOINABLE_STATES.has(match.state))
      throw new Error('Connection details are not available for this match yet.');
    const participant = match.players[0];
    if (participant?.team !== 'TEAM_1' && participant?.team !== 'TEAM_2')
      throw new Error('Only assigned match participants can view connection details.');
    if (
      match.selectedMap === null ||
      match.dathostServerId === null ||
      match.dathostIp === null ||
      match.dathostPort === null ||
      match.encryptedJoinPassword === null
    ) {
      throw new Error('Connection details are still being prepared.');
    }
    const voiceChannelId =
      participant.team === 'TEAM_1'
        ? match.guild.team1VoiceChannelId
        : match.guild.team2VoiceChannelId;
    if (voiceChannelId === null) throw new Error('Your team voice channel is not configured.');
    return {
      team: participant.team,
      map: match.selectedMap,
      voiceChannelId,
      address: `${match.dathostIp}:${String(match.dathostPort)}`,
      password: this.cipher.decrypt(
        match.encryptedJoinPassword,
        `join:${matchId}:${match.dathostServerId}`,
      ),
    };
  }
}
