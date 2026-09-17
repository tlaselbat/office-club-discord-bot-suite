import { describe, expect, it } from 'vitest';
import {
  buildMatchControls,
  buildTeamChoiceControls,
} from '../../../src/modules/tenman/bot/components.js';
import { parseCustomId } from '../../../src/modules/tenman/bot/custom-id.js';

const matchId = '123e4567-e89b-12d3-a456-426614174000';
const secret = 'a'.repeat(32);

describe('match controls', () => {
  it('never exceeds Discord five-row limit', () => {
    for (const state of [
      'OPEN',
      'FULL',
      'TEAM_SETUP',
      'SERVER_READY',
      'MATCH_LOADED',
      'WARMUP',
      'LIVE',
      'PAUSED',
    ] as const) {
      const rows = buildMatchControls({
        matchId,
        version: 2,
        state,
        allowedMaps: ['de_mirage'],
        allowedProfiles: [{ key: 'competitive_5v5', label: 'competitive_5v5' }],
        secret,
      });
      expect(rows.length).toBeLessThanOrEqual(5);
    }
  });

  it('binds ephemeral team choices to the selected participant', () => {
    const rows = buildTeamChoiceControls(matchId, 3, '123456789012345678', secret);
    const button = rows[0]?.components[0];
    expect(button).toBeDefined();
    if (button === undefined || !('custom_id' in button))
      throw new Error('Button missing custom ID');
    expect(parseCustomId(button.custom_id, secret)).toMatchObject({
      action: 'ASSIGN_TEAM_1',
      matchId,
      version: 3,
      targetDiscordUserId: '123456789012345678',
    });
  });
});
