import { describe, expect, it } from 'vitest';
import { createCustomId, parseCustomId } from '../../../src/modules/tenman/bot/custom-id.js';

const secret = 'a'.repeat(32);
const payload = { action: 'JOIN', matchId: '123e4567-e89b-12d3-a456-426614174000', version: 3 };

describe('signed Discord component IDs', () => {
  it('round trips a signed payload', () => {
    expect(parseCustomId(createCustomId(payload, secret), secret)).toEqual(payload);
  });

  it('rejects tampering', () => {
    const customId = createCustomId(payload, secret);
    const finalCharacter = customId.at(-1);
    if (finalCharacter === undefined) throw new Error('Missing custom ID');
    const tampered = `${customId.slice(0, -1)}${finalCharacter === 'a' ? 'b' : 'a'}`;
    expect(() => parseCustomId(tampered, secret)).toThrow();
    expect(() => parseCustomId(customId, 'b'.repeat(32))).toThrow('signature');
  });
});
