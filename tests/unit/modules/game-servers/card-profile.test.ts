import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CARD_ACCENT_COLOR,
  CARD_LINE_IDS,
  CARD_LINE_STYLES,
  DEFAULT_CARD_LINE_STYLES,
  cardProfileSchema,
  resolveCardLines,
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

describe('generic card line contract', () => {
  it('migrates header and legacy body order and preserves description fallback', () => {
    const lines = resolveCardLines(
      {
        fieldOrder: ['serverAddress', 'description', 'currentMap'],
        visibleFields: { playerCount: false },
      },
      ' Custom legacy detail ',
    );
    expect(lines.map((line) => line.id)).toEqual([
      'title',
      'subtitle',
      'playerCount',
      'serverAddress',
      'description',
      'currentMap',
    ]);
    expect(lines[1]?.template).toBe('{statusicon} {status} \u00b7 {location}');
    expect(lines[2]?.visible).toBe(false);
    expect(lines[4]?.template).toBe('Custom legacy detail');
    expect(normalizeCardProfile({}).textLines).toBeUndefined();
    expect(normalizeCardProfile({}).mapArtwork).toBeUndefined();
  });
  it('requires all six unique IDs and validates every template at write boundary', () => {
    const textLines = resolveCardLines({});
    expect(cardProfileSchema.safeParse({ textLines }).success).toBe(true);
    expect(cardProfileSchema.safeParse({ textLines: textLines.slice(1) }).success).toBe(false);
    expect(
      cardProfileSchema.safeParse({ textLines: textLines.map(() => textLines[0]) }).success,
    ).toBe(false);
    for (const id of CARD_LINE_IDS) {
      expect(
        cardProfileSchema.safeParse({
          textLines: textLines.map((line) =>
            line.id === id ? { ...line, template: '{bad}' } : line,
          ),
        }).success,
      ).toBe(false);
      expect(cardProfileSchema.safeParse({ templates: { [id]: '{bad}' } }).success).toBe(false);
    }
    expect(
      cardProfileSchema.safeParse({
        textLines: textLines.map((line) => ({ ...line, template: 'x'.repeat(501) })),
      }).success,
    ).toBe(false);
    expect(cardProfileSchema.safeParse({ templates: { title: 'x'.repeat(500) } }).success).toBe(
      true,
    );
    expect(CARD_LINE_STYLES).toEqual(['large', 'medium', 'small', 'normal', 'subtext']);
    expect(textLines.map((line) => line.style)).toEqual(
      CARD_LINE_IDS.map((id) => DEFAULT_CARD_LINE_STYLES[id]),
    );
  });
  it('repairs a bad persisted template independently and preserves valid settings', () => {
    const textLines = resolveCardLines({}).map((line) =>
      line.id === 'description'
        ? { ...line, template: 'Keep {servername} {bad}', style: 'invalid' }
        : line,
    );
    const profile = normalizeCardProfile({
      accentColor: '#123456',
      textLines,
      mapArtwork: false,
      templates: { title: 'Custom', description: '{bad}' },
    });
    expect(profile.accentColor).toBe('#123456');
    expect(profile.mapArtwork).toBe(false);
    expect(profile.templates.title).toBe('Custom');
    expect(profile.templates.description).toBe('');
    expect(profile.textLines?.find((line) => line.id === 'description')).toMatchObject({
      template: 'Keep {servername} ',
      style: 'normal',
    });
  });
});
