import { describe, expect, it } from 'vitest';
import { renderMatchPanel } from '../../../src/modules/tenman/bot/panel.js';

describe('match panel cleanup UX', () => {
  it('distinguishes a finished match from pending cleanup', () => {
    const panel = renderMatchPanel({
      matchId: '123e4567-e89b-12d3-a456-426614174000',
      leaderMention: '<@123>',
      state: 'FINISHED',
      cleanupStatus: 'RETRY',
      map: 'de_mirage',
      profile: 'competitive_5v5',
      readyCount: 0,
      totalCount: 0,
      team1: [],
      team2: [],
      score: { team1: 13, team2: 9 },
    });
    expect(panel.description).toContain('Match outcome: **FINISHED**');
    expect(panel.description).toContain('new 10man is blocked');
  });
});
