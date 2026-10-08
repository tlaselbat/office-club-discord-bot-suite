import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CARD_ACCENT_COLOR,
  CARD_LINE_IDS,
  CARD_LINE_STYLES,
  DEFAULT_CARD_LINE_STYLES,
  cardProfileSchema,
  resolveCardLines,
  normalizeCardProfile,
  resolveCardLayout,
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
  it('projects legacy cards into a deterministic ordered layout and recovers invalid layouts', () => {
    const first = resolveCardLayout({}, 'Legacy description');
    const second = resolveCardLayout({}, 'Legacy description');
    expect(first).toEqual(second);
    expect(new Set(first.map((element) => element.id)).size).toBe(first.length);
    expect(first.map((element) => element.type)).toEqual([
      'section',
      'text',
      'separator',
      'text',
      'gallery',
      'text',
      'actions',
      'separator',
      'updates',
    ]);
    expect(first.find((element) => element.label === 'Card description')).toMatchObject({
      type: 'text',
      template: 'Legacy description',
    });
    const invalid = normalizeCardProfile({
      layout: { version: 1, elements: [{ id: 'bad', type: 'text' }] },
    });
    expect(invalid.layout).toBeUndefined();
    expect(resolveCardLayout({ layout: { version: 1, elements: [] } }).length).toBeGreaterThan(0);
  });
  it('validates unique IDs, one action row, HTTPS gallery sources, and gallery bounds', () => {
    const layout = resolveCardLayout({});
    expect(cardProfileSchema.safeParse({ layout: { version: 1, elements: layout } }).success).toBe(
      true,
    );
    expect(
      cardProfileSchema.safeParse({ layout: { version: 1, elements: [...layout, layout[0]] } })
        .success,
    ).toBe(false);
    const galleries = layout.map((element) =>
      element.type === 'gallery'
        ? {
            ...element,
            items: element.items.map((item) => ({
              ...item,
              source: 'custom' as const,
              url: 'http://bad.example',
            })),
          }
        : element,
    );
    expect(
      cardProfileSchema.safeParse({ layout: { version: 1, elements: galleries } }).success,
    ).toBe(false);
  });

  it('migrates legacy Updates visibility once and preserves intentional removal in version 2', () => {
    const legacy = resolveCardLayout({});
    const legacyLayout = { version: 1, elements: legacy.slice(0, -1) };
    const migrated = normalizeCardProfile({
      layout: legacyLayout,
      visibleFields: { updates: false },
    });
    expect(migrated.layout?.version).toBe(2);
    expect(migrated.layout?.elements.filter((element) => element.type === 'updates')).toHaveLength(
      1,
    );
    expect(migrated.layout?.elements.find((element) => element.type === 'updates')?.visible).toBe(
      false,
    );

    const removed = cardProfileSchema.parse({
      layout: {
        version: 2,
        elements: migrated.layout?.elements.filter((element) => element.type !== 'updates'),
      },
    });
    expect(removed.layout?.elements.some((element) => element.type === 'updates')).toBe(false);
  });

  it('validates customized Updates settings and rejects duplicate or invalid elements', () => {
    const updates = resolveCardLayout({}).find((element) => element.type === 'updates');
    if (!updates) throw new Error('Expected Updates element');
    const customized = {
      ...updates,
      title: 'Community News',
      announcements: { ...updates.announcements, displayLabel: 'News', latestMessageLength: 500 },
    };
    expect(
      cardProfileSchema.safeParse({ layout: { version: 2, elements: [customized] } }).success,
    ).toBe(true);
    expect(
      cardProfileSchema.safeParse({ layout: { version: 2, elements: [customized, customized] } })
        .success,
    ).toBe(false);
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 2,
          elements: [
            { ...customized, changelog: { ...customized.changelog, latestMessageLength: 5000 } },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('normalizes pre-control Updates layouts and validates hidden headings and feed order', () => {
    const updates = resolveCardLayout({}).find((element) => element.type === 'updates');
    if (!updates) throw new Error('Expected Updates element');
    const previous: Record<string, unknown> = { ...updates };
    delete previous.showHeading;
    delete previous.feedOrder;
    delete previous.separator;
    const normalized = normalizeCardProfile({ layout: { version: 2, elements: [previous] } });
    const migrated = normalized.layout?.elements[0];
    expect(migrated).toMatchObject({
      type: 'updates',
      showHeading: true,
      feedOrder: ['ANNOUNCEMENTS', 'CHANGELOG'],
      separator: { enabled: false, divider: true, spacing: 1 },
    });
    if (migrated?.type !== 'updates') throw new Error('Expected normalized Updates element');
    expect(
      cardProfileSchema.safeParse({
        layout: { version: 2, elements: [{ ...migrated, showHeading: false, title: '' }] },
      }).success,
    ).toBe(true);
    expect(
      cardProfileSchema.safeParse({
        layout: { version: 2, elements: [{ ...migrated, feedOrder: ['CHANGELOG', 'CHANGELOG'] }] },
      }).success,
    ).toBe(false);
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 2,
          elements: [{ ...migrated, separator: { enabled: true, divider: false, spacing: 3 } }],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects layouts whose enabled Updates structure would exceed Discord component limits', () => {
    const updates = resolveCardLayout({}).find((element) => element.type === 'updates');
    if (!updates) throw new Error('Expected Updates element');
    const textElements = Array.from({ length: 34 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      type: 'text' as const,
      label: `Text ${String(index + 1)}`,
      template: 'Content',
      visible: true,
      style: 'normal' as const,
    }));
    expect(
      cardProfileSchema.safeParse({
        layout: { version: 2, elements: [...textElements, updates] },
      }).success,
    ).toBe(false);
    expect(
      cardProfileSchema.safeParse({
        layout: { version: 2, elements: [...textElements.slice(0, 29), updates] },
      }).success,
    ).toBe(true);
    expect(
      cardProfileSchema.safeParse({
        layout: { version: 2, elements: [...textElements.slice(0, 31), updates] },
      }).success,
    ).toBe(false);
    const compatible = normalizeCardProfile({
      layout: { version: 2, elements: [...textElements.slice(0, 29), updates] },
    });
    expect(compatible.layout?.elements).toHaveLength(30);
  });
});
