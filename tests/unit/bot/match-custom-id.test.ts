import { describe, expect, it } from 'vitest';
import {
  createMatchCustomId,
  parseMatchCustomId,
} from '../../../src/modules/tenman/bot/match-custom-id.js';

describe('signed V2 match component IDs', () => {
  it('binds action, match version, phase generation, and target', () => {
    const secret = 'test-secret';
    const payload = {
      action: 'PICK',
      matchId: '123e4567-e89b-12d3-a456-426614174000',
      version: 7,
      phaseGeneration: 3,
      targetDiscordUserId: '123456789012345678',
    };
    const id = createMatchCustomId(payload, secret);
    expect(parseMatchCustomId(id, secret)).toEqual(payload);
    expect(() => parseMatchCustomId(id.replace('PICK', 'VETO'), secret)).toThrow(
      'Invalid match component signature',
    );
  });

  it('does not allow a control signed for one match, generation, or player to be reused elsewhere', () => {
    const secret = 'test-secret';
    const firstMatch = createMatchCustomId(
      {
        action: 'DRAFT_PICK',
        matchId: '123e4567-e89b-12d3-a456-426614174000',
        version: 7,
        phaseGeneration: 3,
        targetDiscordUserId: '123456789012345678',
      },
      secret,
    );

    // Altering any signed binding invalidates the control before it can be routed.
    expect(() =>
      parseMatchCustomId(
        firstMatch.replace('123e4567e89b12d3a456426614174000', '223e4567e89b12d3a456426614174000'),
        secret,
      ),
    ).toThrow('Invalid match component signature');
    expect(() => parseMatchCustomId(firstMatch.replace(':3:', ':4:'), secret)).toThrow(
      'Invalid match component signature',
    );
    expect(() =>
      parseMatchCustomId(firstMatch.replace('123456789012345678', '223456789012345678'), secret),
    ).toThrow('Invalid match component signature');
  });

  it('rejects IDs signed by another deployment secret', () => {
    const id = createMatchCustomId(
      {
        action: 'READY',
        matchId: '123e4567-e89b-12d3-a456-426614174000',
        version: 0,
        phaseGeneration: 0,
      },
      'old-secret',
    );
    expect(() => parseMatchCustomId(id, 'new-secret')).toThrow('Invalid match component signature');
  });
});
