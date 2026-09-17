import { describe, expect, it } from 'vitest';
import {
  createOAuthState,
  csrfToken,
  verifyCsrf,
  verifyOAuthState,
} from '../../../src/http/admin/security.js';

const secret = 'a'.repeat(32);
describe('admin request security', () => {
  it('accepts current OAuth state and rejects tampering and expiry', () => {
    const state = createOAuthState(secret, 1_000_000);
    expect(verifyOAuthState(secret, state, 1_001_000)).toBe(true);
    expect(verifyOAuthState(secret, `${state}x`, 1_001_000)).toBe(false);
    expect(verifyOAuthState(secret, state, 1_700_000)).toBe(false);
  });

  it('binds CSRF to the session token', () => {
    const token = csrfToken(secret, 'session-a');
    expect(verifyCsrf(secret, 'session-a', token)).toBe(true);
    expect(verifyCsrf(secret, 'session-b', token)).toBe(false);
  });
});
