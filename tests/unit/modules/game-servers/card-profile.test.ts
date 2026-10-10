import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CARD_ACCENT_COLOR,
  defaultUpdatesElement,
  CARD_LINE_IDS,
  CARD_LINE_STYLES,
  DEFAULT_CARD_LINE_STYLES,
  DEFAULT_CARD_TEMPLATES,
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
    expect(
      validateCardTemplate('{Announcements.Preview} {changelog.time} {ANNOUNCEMENTS.URL}'),
    ).toEqual([]);
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
      'text',
      'text',
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

  it('migrates legacy Updates visibility to independent text rows and preserves intentional removal', () => {
    const legacy = resolveCardLayout({});
    const legacyLayout = { version: 1, elements: legacy.slice(0, 8) };
    const migrated = normalizeCardProfile({
      layout: legacyLayout,
      visibleFields: { updates: false },
    });
    expect(migrated.layout?.version).toBe(3);
    expect(
      migrated.layout?.elements.filter((element) => element.type === 'text').slice(-2),
    ).toHaveLength(2);
    expect(migrated.layout?.elements.slice(-2).every((element) => !element.visible)).toBe(true);

    const removed = cardProfileSchema.parse({
      layout: {
        version: 3,
        buttons: migrated.layout?.buttons,
        elements: migrated.layout?.elements.filter((element) => element.type !== 'updates'),
      },
    });
    expect(removed.layout?.elements.some((element) => element.type === 'updates')).toBe(false);
  });

  it('validates customized Updates settings and rejects duplicate or invalid elements', () => {
    const updates = defaultUpdatesElement('00000000-0000-4000-8000-000000000001');
    if (updates.type !== 'updates') throw new Error('Expected Updates fixture');
    const customized = {
      ...updates,
      showHeading: true,
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

  it('converts version 2 feed settings into editable version 3 text rows', () => {
    const updates = defaultUpdatesElement('00000000-0000-4000-8000-000000000001');
    if (updates.type !== 'updates') throw new Error('Expected legacy Updates fixture');
    const customized = {
      ...updates,
      showHeading: true,
      title: 'Community News',
      feedOrder: ['CHANGELOG', 'ANNOUNCEMENTS'] as const,
      announcements: { ...updates.announcements, displayLabel: 'News', latestMessageLength: 500 },
      changelog: { ...updates.changelog, showTimestamp: false, openButtonLabel: 'Read notes' },
    };
    const normalized = normalizeCardProfile({ layout: { version: 2, elements: [customized] } });
    expect(normalized.layout?.version).toBe(3);
    expect(normalized.layout?.elements.map((element) => element.type)).toEqual([
      'text',
      'text',
      'text',
    ]);
    expect(normalized.layout?.elements[0]).toMatchObject({
      label: 'Latest Updates',
      template: 'Community News',
    });
    expect(normalized.layout?.elements[1]).toMatchObject({
      label: 'Changelog',
      template: expect.stringContaining('{changelog.preview}'),
      previewLength: 240,
      accessory: { destination: 'CHANGELOG', label: 'Read notes', enabled: true },
    });
    expect(normalized.layout?.elements[2]).toMatchObject({
      label: 'News',
      previewLength: 500,
      accessory: { destination: 'ANNOUNCEMENTS', enabled: true },
    });
  });

  it('migrates legacy action rows to stable button definitions without changing element order', () => {
    const layout = {
      version: 2,
      elements: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          type: 'text',
          label: 'Intro',
          template: 'Hello',
          visible: true,
          style: 'normal',
        },
        {
          id: '00000000-0000-4000-8000-000000000012',
          type: 'actions',
          label: 'Server actions',
          visible: true,
        },
        {
          id: '00000000-0000-4000-8000-000000000013',
          type: 'separator',
          label: 'End',
          visible: true,
          divider: true,
          spacing: 1,
        },
      ],
    };
    const input = {
      layout,
      buttons: { connect: true, mapRules: true, connectLabel: 'Join', mapRulesLabel: 'Rules' },
    };
    const first = normalizeCardProfile(input).layout;
    const second = normalizeCardProfile(input).layout;
    expect(first).toEqual(second);
    expect(first?.elements.map((element) => element.id)).toEqual(
      layout.elements.map((element) => element.id),
    );
    expect(first?.elements[1]).toMatchObject({
      type: 'button_row',
      buttonIds: [expect.any(String), expect.any(String)],
    });
    expect(first?.buttons.map((button) => button.label)).toEqual(['Join', 'Rules']);
  });

  it('allows repeated button placements while rejecting dangling and overfull placements and unsafe links', () => {
    const button = (id: string) => ({
      id,
      label: 'Go',
      emoji: null,
      style: 'secondary',
      action: 'copy-address',
      destination: null,
      visible: true,
    });
    const ids = Array.from(
      { length: 6 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const row = {
      id: '00000000-0000-4000-8000-000000000099',
      type: 'button_row',
      label: 'Buttons',
      visible: true,
      buttonIds: ids.slice(0, 5),
    };
    expect(
      cardProfileSchema.safeParse({
        layout: { version: 3, buttons: ids.slice(0, 5).map(button), elements: [row] },
      }).success,
    ).toBe(true);
    const firstId = ids[0] ?? '';
    const secondId = ids[1] ?? '';
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 3,
          buttons: [button(firstId)],
          elements: [{ ...row, buttonIds: [firstId, firstId] }],
        },
      }).success,
    ).toBe(true);
    const buttonWithLabel = (label: string) => ({
      layout: {
        version: 3,
        buttons: [{ ...button(firstId), label }],
        elements: [{ ...row, buttonIds: [firstId] }],
      },
    });
    expect(
      cardProfileSchema.safeParse({
        ...buttonWithLabel('<:party:12345678901234567> ' + 'x'.repeat(80)),
      }).success,
    ).toBe(true);
    expect(
      cardProfileSchema.safeParse({
        ...buttonWithLabel('<:party:12345678901234567> ' + 'x'.repeat(81)),
      }).success,
    ).toBe(false);
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 3,
          buttons: ids.slice(0, 5).map(button),
          elements: [{ ...row, buttonIds: [...ids.slice(0, 5), firstId] }],
        },
      }).success,
    ).toBe(false);
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 3,
          buttons: [button(firstId)],
          elements: [{ ...row, buttonIds: [secondId] }],
        },
      }).success,
    ).toBe(false);
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 3,
          buttons: [
            {
              ...button(firstId),
              action: 'external-https-url',
              style: 'link',
              destination: 'javascript:alert(1)',
            },
          ],
          elements: [{ ...row, buttonIds: [firstId] }],
        },
      }).success,
    ).toBe(false);
  });

  it('defaults all new card lines and generated Updates rows to plain formatting', () => {
    expect(DEFAULT_CARD_LINE_STYLES).toEqual({
      title: 'normal',
      subtitle: 'normal',
      playerCount: 'normal',
      description: 'normal',
      currentMap: 'normal',
      serverAddress: 'normal',
    });
    expect(Object.values(DEFAULT_CARD_TEMPLATES).join('')).not.toMatch(/[*`]|-#/);
    const updates = defaultUpdatesElement('00000000-0000-4000-8000-000000000001');
    if (updates.type !== 'updates') throw new Error('Expected Updates fixture');
    expect(updates).toMatchObject({ showHeading: false, title: 'Latest Updates' });
    expect(updates.announcements).toMatchObject({
      timestampMode: 'plain',
      showNew: false,
      displayLabel: 'Announcements',
    });
    expect(updates.changelog).toMatchObject({
      timestampMode: 'plain',
      showNew: false,
      displayLabel: 'Changelog',
    });
  });

  it('validates independent nested Updates blocks, IDs, URLs and total component budget', () => {
    const updates = defaultUpdatesElement('00000000-0000-4000-8000-000000000001');
    const blocks = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        type: 'feed',
        feed: 'CHANGELOG',
        visible: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        type: 'separator',
        divider: true,
        spacing: 2,
        visible: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        type: 'text',
        template: 'Notice for {servername}',
        style: 'normal',
        visible: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        type: 'gallery',
        visible: true,
        items: [
          {
            id: '00000000-0000-4000-8000-000000000005',
            source: 'custom',
            url: 'https://example.com/image.png',
            description: 'An update',
          },
        ],
      },
    ] as const;
    const valid = { ...updates, blocks };
    const parse = (element: unknown) =>
      cardProfileSchema.safeParse({
        layout: { version: 2, elements: [element] },
      }).success;
    expect(parse(valid)).toBe(true);
    expect(parse({ ...valid, blocks: [...blocks, blocks[0]] })).toBe(false);
    expect(
      parse({
        ...valid,
        blocks: [...blocks, { ...blocks[0], id: '00000000-0000-4000-8000-000000000006' }],
      }),
    ).toBe(false);
    expect(
      parse({
        ...valid,
        blocks: [
          ...blocks.slice(0, 3),
          { ...blocks[3], items: [{ ...blocks[3].items[0], url: 'http://example.com/image.png' }] },
        ],
      }),
    ).toBe(false);
    expect(parse({ ...valid, blocks: [...blocks.slice(0, 3), { ...blocks[3], items: [] }] })).toBe(
      false,
    );
    expect(
      parse({
        ...valid,
        blocks: Array.from({ length: 25 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          type: 'text',
          template: 'x',
          style: 'normal',
          visible: true,
        })),
      }),
    ).toBe(true);
    const textElements = resolveCardLayout({}).filter((element) => element.type === 'text');
    expect(
      cardProfileSchema.safeParse({
        layout: {
          version: 2,
          elements: [
            ...textElements,
            {
              ...valid,
              blocks: Array.from({ length: 25 }, (_, i) => ({
                id: `00000000-0000-4000-8000-${String(i + 11).padStart(12, '0')}`,
                type: 'feed',
                feed: i % 2 ? 'ANNOUNCEMENTS' : 'CHANGELOG',
                visible: true,
              })),
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects layouts whose enabled Updates structure would exceed Discord component limits', () => {
    const updates = defaultUpdatesElement('00000000-0000-4000-8000-000000000099');
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
        layout: { version: 2, elements: [...textElements.slice(0, 32), updates] },
      }).success,
    ).toBe(false);
    const compatible = normalizeCardProfile({
      layout: { version: 2, elements: [...textElements.slice(0, 29), updates] },
    });
    expect(compatible.layout?.elements).toHaveLength(31);
  });
});
