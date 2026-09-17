import { describe, expect, it } from 'vitest';
import { isSteamId64 } from '../../src/modules/tenman/domain/steam-id.js';

describe('SteamID64 validation', () => {
  it('accepts a valid individual account ID', () => {
    expect(isSteamId64('76561197960265728')).toBe(true);
  });

  it('rejects malformed and out-of-range IDs', () => {
    expect(isSteamId64('123')).toBe(false);
    expect(isSteamId64('765611999999999999')).toBe(false);
  });
});
