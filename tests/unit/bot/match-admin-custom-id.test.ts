import { describe, expect, it } from 'vitest';
import {
  createMatchAdminCustomId,
  parseMatchAdminCustomId,
} from '../../../src/modules/tenman/bot/match-admin-custom-id.js';

const secret = 'match-admin-secret';
const payload = {
  action: 'RB' as const,
  matchId: '123e4567-e89b-12d3-a456-426614174000',
  version: 8,
  phaseGeneration: 5,
  actorDiscordUserId: '123456789012345678',
  expiresAt: 2_000,
};

describe('signed match-admin component IDs', () => {
  it('round-trips all stale and actor bindings', () => {
    const customId = createMatchAdminCustomId(payload, secret);
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseMatchAdminCustomId(customId, secret, 1_999_000)).toEqual(payload);
  });

  it('rejects a confirmation replayed for another match, version, actor, or secret', () => {
    const customId = createMatchAdminCustomId(payload, secret);
    expect(() =>
      parseMatchAdminCustomId(
        customId.replace('123e4567e89b12d3a456426614174000', '223e4567e89b12d3a456426614174000'),
        secret,
        0,
      ),
    ).toThrow('signature');
    expect(() => parseMatchAdminCustomId(customId.replace(':8:', ':9:'), secret, 0)).toThrow(
      'signature',
    );
    expect(() =>
      parseMatchAdminCustomId(
        customId.replace('123456789012345678', '223456789012345678'),
        secret,
        0,
      ),
    ).toThrow('signature');
    expect(() => parseMatchAdminCustomId(customId, 'different-secret', 0)).toThrow('signature');
  });

  it('rejects an expired confirmation even with a valid signature', () => {
    const customId = createMatchAdminCustomId(payload, secret);
    expect(() => parseMatchAdminCustomId(customId, secret, 2_001_000)).toThrow('expired');
  });
});
