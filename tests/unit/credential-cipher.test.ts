import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher } from '../../src/modules/tenman/services/credential-cipher.js';

describe('CredentialCipher', () => {
  it('encrypts and authenticates credentials with match context', () => {
    const cipher = new CredentialCipher(randomBytes(32).toString('base64'));
    const encrypted = cipher.encrypt('rcon-secret', 'match:one');
    expect(encrypted).not.toContain('rcon-secret');
    expect(cipher.decrypt(encrypted, 'match:one')).toBe('rcon-secret');
    expect(() => cipher.decrypt(encrypted, 'match:two')).toThrow();
  });

  it('rejects invalid key lengths', () => {
    expect(() => new CredentialCipher(Buffer.from('short').toString('base64'))).toThrow('32 bytes');
  });
});
