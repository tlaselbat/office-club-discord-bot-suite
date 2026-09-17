import { describe, expect, it } from 'vitest';
import {
  desiredLobbyMoves,
  desiredTeamVoiceMoves,
} from '../../src/modules/tenman/voice/reconciliation.js';

describe('voice reconciliation', () => {
  it('uses persisted teams and marks disconnected users waiting', () => {
    const result = desiredTeamVoiceMoves(
      [
        { discordUserId: 'one', team: 'TEAM_1' },
        { discordUserId: 'two', team: 'TEAM_2' },
      ],
      new Map([['one', 'lobby']]),
      { lobby: 'lobby', team1: 'team1', team2: 'team2' },
    );
    expect(result.moves).toEqual([{ discordUserId: 'one', destinationChannelId: 'team1' }]);
    expect(result.waiting).toEqual(['two']);
  });

  it('is idempotent and returns only connected participants to lobby', () => {
    expect(desiredLobbyMoves(['one', 'two'], new Map([['one', 'team1']]), 'lobby')).toEqual([
      { discordUserId: 'one', destinationChannelId: 'lobby' },
    ]);
  });
});
