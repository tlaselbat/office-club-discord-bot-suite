export interface VoiceParticipant {
  discordUserId: string;
  team: 'TEAM_1' | 'TEAM_2';
}

export interface VoiceChannels {
  lobby: string;
  team1: string;
  team2: string;
}

export interface VoiceMove {
  discordUserId: string;
  destinationChannelId: string;
}

export function desiredTeamVoiceMoves(
  participants: readonly VoiceParticipant[],
  connectedChannelByUser: ReadonlyMap<string, string>,
  channels: VoiceChannels,
): { moves: readonly VoiceMove[]; waiting: readonly string[] } {
  const moves: VoiceMove[] = [];
  const waiting: string[] = [];
  for (const participant of participants) {
    const current = connectedChannelByUser.get(participant.discordUserId);
    if (current === undefined) {
      waiting.push(participant.discordUserId);
      continue;
    }
    const destination = participant.team === 'TEAM_1' ? channels.team1 : channels.team2;
    if (current !== destination)
      moves.push({ discordUserId: participant.discordUserId, destinationChannelId: destination });
  }
  return { moves, waiting };
}

export function desiredLobbyMoves(
  participantIds: readonly string[],
  connectedChannelByUser: ReadonlyMap<string, string>,
  lobbyChannelId: string,
): readonly VoiceMove[] {
  return participantIds.flatMap((discordUserId) => {
    const current = connectedChannelByUser.get(discordUserId);
    return current !== undefined && current !== lobbyChannelId
      ? [{ discordUserId, destinationChannelId: lobbyChannelId }]
      : [];
  });
}
