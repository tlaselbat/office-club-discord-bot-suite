import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CARD_ACCENT_COLOR,
  normalizeCardProfile,
  resolveCardProfile,
  validateCardTemplate,
} from '../../../../src/modules/game-servers/card-profile.js';

afterEach(() => vi.unstubAllEnvs());

describe('game-server card profile', () => {
  it('normalizes legacy and malformed persisted data to safe defaults', () => {
    expect(normalizeCardProfile(undefined)).toMatchObject({
      accentColor: DEFAULT_CARD_ACCENT_COLOR,
      thumbnailImageUrl: null,
      onlineEmojiId: null,
    });
    expect(normalizeCardProfile({ thumbnailImageUrl: 'http://unsafe.example' })).toMatchObject({
      accentColor: DEFAULT_CARD_ACCENT_COLOR,
      thumbnailImageUrl: null,
    });
    expect(
      normalizeCardProfile({ accentColor: '#123456', thumbnailImageUrl: 'http://unsafe.example' }),
    ).toMatchObject({ accentColor: '#123456', thumbnailImageUrl: null });
  });

  it('uses only validated environment emoji IDs when no persisted override is set', () => {
    vi.stubEnv('GAME_SERVER_EMOJI_ONLINE_ID', 'invalid');
    vi.stubEnv('GAME_SERVER_EMOJI_OFFLINE_ID', '12345678901234567');
    const profile = resolveCardProfile({ onlineEmojiId: null, offlineEmojiId: null });
    expect(profile.onlineEmojiId).toBeNull();
    expect(profile.offlineEmojiId).toBe('12345678901234567');
  });

  it('validates known placeholders, supports the legacy typo, and rejects unknown names', () => {
    expect(validateCardTemplate('{playercount} of {maxplayers}')).toEqual([]);
    expect(validateCardTemplate('{severaddress}')).toEqual([]);
    expect(validateCardTemplate('{tickrate}')).toEqual(['Unknown placeholder {tickrate}.']);
  });
});
