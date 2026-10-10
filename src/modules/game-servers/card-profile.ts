import { z } from 'zod';

export const DEFAULT_CARD_ACCENT_COLOR = '#2b8aef';
export const DEFAULT_CARD_DESCRIPTION =
  'Challenge other players 1v1, warm up, or kill time between matches.\n-# Open to all Office Club members.';
export const DEFAULT_THUMBNAIL_IMAGE_URL =
  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-thumbnail.png';

export const CARD_TEMPLATE_FIELDS = [
  'title',
  'subtitle',
  'description',
  'playerCount',
  'currentMap',
  'serverAddress',
] as const;
export type CardTemplateField = (typeof CARD_TEMPLATE_FIELDS)[number];
export const CARD_BODY_FIELDS = ['description', 'currentMap', 'serverAddress'] as const;
export const DEFAULT_CARD_TEMPLATES: Record<CardTemplateField, string> = {
  title: '{servername}',
  subtitle: '{statusicon} {status}{location}',
  description: DEFAULT_CARD_DESCRIPTION,
  playerCount: '{playercount} players',
  currentMap: '**Current map**\n`{currentmap}`',
  serverAddress: '`{serveraddress}`',
};
export const DEFAULT_STATUS_LABELS = {
  online: 'Online',
  offline: 'Offline',
  starting: 'Server starting…',
  stale: 'Status stale',
  pending: 'Status pending',
  unavailable: 'Server unavailable',
};
export const CARD_PLACEHOLDERS = [
  ['playercount', 'Connected and maximum players, such as 0/5'],
  ['players', 'Connected player count'],
  ['maxplayers', 'Maximum player count'],
  ['online', 'Configured status icon and label'],
  ['status', 'Current human-readable server state'],
  ['statusicon', 'Configured icon for the current server state'],
  ['location', 'Configured DatHost data center'],
  ['serveraddress', 'Configured host and port'],
  ['serverip', 'Configured hostname or IP'],
  ['serverport', 'Configured connection port'],
  ['currentmap', 'Current map from the cached server snapshot'],
  ['servername', 'Configured display name'],
  ['lastupdated', 'Time since the latest successful snapshot'],
] as const;

const templateFieldSchema = z.object({
  title: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.title),
  subtitle: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.subtitle),
  description: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.description),
  playerCount: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.playerCount),
  currentMap: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.currentMap),
  serverAddress: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.serverAddress),
});
const placeholderNames = new Set<string>(CARD_PLACEHOLDERS.map(([name]) => name));
export function validateCardTemplate(template: string): string[] {
  const errors: string[] = [];
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const name = (match[1] ?? '').toLowerCase();
    if (!placeholderNames.has(name) && name !== 'severaddress') {
      errors.push(`Unknown placeholder {${match[1] ?? ''}}.`);
    }
  }
  return [...new Set(errors)];
}
function validatedTemplate() {
  return z
    .string()
    .max(500)
    .superRefine((template, context) => {
      for (const message of validateCardTemplate(template))
        context.addIssue({ code: 'custom', message });
    });
}

export const CARD_LINE_IDS = [
  'title',
  'subtitle',
  'playerCount',
  'description',
  'currentMap',
  'serverAddress',
] as const;
export const CARD_LINE_STYLES = ['large', 'medium', 'small', 'normal', 'subtext'] as const;
export type CardLineStyle = (typeof CARD_LINE_STYLES)[number];
export const DEFAULT_CARD_LINE_STYLES: Record<(typeof CARD_LINE_IDS)[number], CardLineStyle> = {
  title: 'large',
  subtitle: 'small',
  playerCount: 'subtext',
  description: 'normal',
  currentMap: 'normal',
  serverAddress: 'normal',
};
const cardLineSchema = z.object({
  id: z.enum(CARD_LINE_IDS),
  template: validatedTemplate(),
  visible: z.boolean(),
  style: z.enum(CARD_LINE_STYLES),
});
export type CardLine = z.infer<typeof cardLineSchema>;
const textLinesSchema = z
  .array(cardLineSchema)
  .length(6)
  .refine(
    (lines) => new Set(lines.map((line) => line.id)).size === 6,
    'Each line ID must occur exactly once',
  );

const visibleFieldSchema = z.object({
  title: z.boolean().default(true),
  subtitle: z.boolean().default(true),
  description: z.boolean().default(true),
  playerCount: z.boolean().default(true),
  currentMap: z.boolean().default(true),
  serverAddress: z.boolean().default(true),
  updates: z.boolean().default(true),
});
const statusLabelsSchema = z.object({
  online: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.online),
  offline: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.offline),
  starting: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.starting),
  stale: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.stale),
  pending: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.pending),
  unavailable: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.unavailable),
});
const buttonSchema = z.object({
  connect: z.boolean().default(true),
  mapRules: z.boolean().default(true),
  connectLabel: z.string().trim().min(1).max(80).default('Connect'),
  mapRulesLabel: z.string().trim().min(1).max(80).default('Map & Rules'),
});

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', 'Must use HTTPS');
const emojiId = z.string().regex(/^\d{17,20}$/, 'Must be a Discord emoji ID');

export const CARD_LAYOUT_VERSION = 2;
const updatesFeedSchema = z.object({
  visible: z.boolean().default(true),
  displayLabel: z.string().trim().min(1).max(80),
  textStyle: z.enum(['normal', 'heading', 'subtext']),
  emptyPlaceholder: z.string().max(240),
  showTimestamp: z.boolean(),
  showOpenButton: z.boolean(),
  openButtonLabel: z.string().trim().min(1).max(80),
  latestMessageLength: z.number().int().min(40).max(1000),
});
/** Optional nested layout. Older profiles retain their exact feed-order rendering until edited. */
const updateBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.uuid(), type: z.literal('heading'), visible: z.boolean() }),
  z.object({
    id: z.uuid(), type: z.literal('feed'), visible: z.boolean(),
    feed: z.enum(['ANNOUNCEMENTS', 'CHANGELOG']),
  }),
  z.object({
    id: z.uuid(), type: z.literal('text'), visible: z.boolean(),
    template: validatedTemplate(), style: z.enum(CARD_LINE_STYLES),
  }),
  z.object({
    id: z.uuid(), type: z.literal('separator'), visible: z.boolean(),
    divider: z.boolean(), spacing: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    id: z.uuid(), type: z.literal('gallery'), visible: z.boolean(),
    items: z.array(z.object({
      id: z.uuid(),
      source: z.enum(['map', 'custom', 'fallback']),
      url: httpsUrl.nullable().default(null),
      description: z.string().max(1024),
    })).min(1).max(10),
  }),
]);
export type UpdateLayoutBlock = z.infer<typeof updateBlockSchema>;
const updatesElementSchema = z
  .object({
    id: z.uuid(),
    type: z.literal('updates'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    showHeading: z.boolean().default(true),
    title: z.string().trim().max(80),
    headingStyle: z.enum(['normal', 'heading', 'subtext']),
    blocks: z.array(updateBlockSchema).max(25).optional(),
    feedOrder: z
      .array(z.enum(['ANNOUNCEMENTS', 'CHANGELOG']))
      .length(2)
      .refine((order) => new Set(order).size === 2)
      .default(['ANNOUNCEMENTS', 'CHANGELOG']),
    separator: z
      .object({
        enabled: z.boolean().default(false),
        divider: z.boolean().default(true),
        spacing: z.union([z.literal(1), z.literal(2)]).default(1),
      })
      .default({ enabled: false, divider: true, spacing: 1 }),
    emptyBehavior: z.enum(['show_placeholders', 'hide_empty_entries']),
    announcements: updatesFeedSchema,
    changelog: updatesFeedSchema,
  })
  .superRefine((updates, context) => {
    if (updates.showHeading && !updates.title)
      context.addIssue({ code: 'custom', path: ['title'], message: 'Enter a heading or hide it.' });
    if (updates.blocks !== undefined) {
      const ids = updates.blocks.map((block) => block.id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({ code: 'custom', path: ['blocks'], message: 'Update block IDs must be unique.' });
      for (const type of ['heading', 'ANNOUNCEMENTS', 'CHANGELOG'] as const) {
        const matches = updates.blocks.filter((block) =>
          type === 'heading' ? block.type === 'heading' : block.type === 'feed' && block.feed === type,
        );
        if (matches.length > 1)
          context.addIssue({ code: 'custom', path: ['blocks'], message: 'Heading and feed blocks can appear only once.' });
      }
    }
  });
const cardLayoutElementSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.uuid(),
    type: z.literal('text'),
    label: z.string().trim().min(1).max(80),
    template: validatedTemplate(),
    visible: z.boolean(),
    style: z.enum(CARD_LINE_STYLES),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('gallery'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.uuid(),
          source: z.enum(['map', 'custom', 'fallback']),
          url: httpsUrl.nullable().default(null),
          description: z.string().max(1024),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('separator'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    divider: z.boolean(),
    spacing: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('section'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    template: validatedTemplate(),
    style: z.enum(CARD_LINE_STYLES),
    thumbnailUrl: httpsUrl.nullable().default(null),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('actions'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
  }),
  updatesElementSchema,
]);
export type CardLayoutElement = z.infer<typeof cardLayoutElementSchema>;
export const cardLayoutSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(CARD_LAYOUT_VERSION)]),
    elements: z.array(cardLayoutElementSchema).min(1).max(35),
  })
  .superRefine((layout, context) => {
    const ids = layout.elements.map((element) => element.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Layout element IDs must be unique.' });
    if (layout.elements.filter((element) => element.type === 'actions').length > 1)
      context.addIssue({ code: 'custom', message: 'Only one action row is supported.' });
    if (layout.elements.filter((element) => element.type === 'updates').length > 1)
      context.addIssue({
        code: 'custom',
        message: 'Only one Community Updates element is supported.',
      });
    const componentCount =
      1 +
      layout.elements.reduce((total, element) => {
        if (!element.visible) return total;
        if (element.type === 'section') return total + 3;
        if (element.type === 'actions') return total + 3;
        if (element.type !== 'updates') return total + 1;
        if (element.blocks !== undefined) {
          return total + element.blocks.reduce((sum, block) => {
            if (!block.visible) return sum;
            if (block.type === 'heading') return sum + (element.showHeading ? 1 : 0);
            if (block.type === 'feed') {
              const feed = block.feed === 'ANNOUNCEMENTS' ? element.announcements : element.changelog;
              return sum + (feed.visible ? (feed.showOpenButton ? 4 : 2) : 0);
            }
            return sum + 1;
          }, 0);
        }
        const visibleFeeds = [element.announcements, element.changelog].filter(
          (feed) => feed.visible,
        );
        if (!visibleFeeds.length) return total;
        return (
          total +
          (element.showHeading ? 1 : 0) +
          visibleFeeds.reduce((feeds, feed) => feeds + (feed.showOpenButton ? 4 : 2), 0) +
          (visibleFeeds.length > 1 && element.separator.enabled ? 1 : 0)
        );
      }, 0);
    if (componentCount > 40)
      context.addIssue({
        code: 'custom',
        path: ['elements'],
        message: 'Visible card layout exceeds Discord’s 40 component message limit.',
      });
  });

export function defaultUpdatesElement(id: string): CardLayoutElement {
  return {
    id,
    type: 'updates',
    label: 'Community Updates',
    visible: true,
    title: '**Latest Updates**',
    showHeading: true,
    headingStyle: 'normal',
    feedOrder: ['ANNOUNCEMENTS', 'CHANGELOG'],
    separator: { enabled: false, divider: true, spacing: 1 },
    emptyBehavior: 'show_placeholders',
    announcements: {
      visible: true,
      displayLabel: '📢 **Announcements**',
      textStyle: 'normal',
      emptyPlaceholder: 'No announcements yet.',
      showTimestamp: true,
      showOpenButton: true,
      openButtonLabel: 'Open',
      latestMessageLength: 240,
    },
    changelog: {
      visible: true,
      displayLabel: '🛠 **Changelog**',
      textStyle: 'normal',
      emptyPlaceholder: 'No changelog entries yet.',
      showTimestamp: true,
      showOpenButton: true,
      openButtonLabel: 'Open',
      latestMessageLength: 240,
    },
  };
}

/** Persisted card presentation overrides. Null image and emoji values inherit their legacy defaults. */
export const cardProfileSchema = z.object({
  layout: cardLayoutSchema.optional(),
  textLines: textLinesSchema.optional(),
  mapArtwork: z.boolean().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default(DEFAULT_CARD_ACCENT_COLOR),
  thumbnailImageUrl: httpsUrl.nullable().default(null),
  onlineEmojiId: emojiId.nullable().default(null),
  offlineEmojiId: emojiId.nullable().default(null),
  warningEmojiId: emojiId.nullable().default(null),
  pendingEmojiId: emojiId.nullable().default(null),
  templates: templateFieldSchema.default(DEFAULT_CARD_TEMPLATES),
  visibleFields: visibleFieldSchema.default({
    title: true,
    subtitle: true,
    description: true,
    playerCount: true,
    currentMap: true,
    serverAddress: true,
    updates: true,
  }),
  statusLabels: statusLabelsSchema.default(DEFAULT_STATUS_LABELS),
  fieldOrder: z
    .array(z.enum(CARD_BODY_FIELDS))
    .length(CARD_BODY_FIELDS.length)
    .refine((fields) => new Set(fields).size === CARD_BODY_FIELDS.length)
    .default([...CARD_BODY_FIELDS]),
  buttons: buttonSchema.default({
    connect: true,
    mapRules: true,
    connectLabel: 'Connect',
    mapRulesLabel: 'Map & Rules',
  }),
});

export type CardProfile = z.infer<typeof cardProfileSchema>;
export type CardProfileInput = z.input<typeof cardProfileSchema>;

export interface ResolvedCardProfile extends CardProfile {
  thumbnailImageUrl: string;
  onlineEmojiId: string | null;
  offlineEmojiId: string | null;
  warningEmojiId: string | null;
  pendingEmojiId: string | null;
}

/** Safely reads JSON persisted by older versions or hand-edited database rows. */
export function normalizeCardProfile(value: unknown): CardProfile {
  const source =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const field = <T>(schema: z.ZodType<T>, input: unknown): T => {
    const parsed = schema.safeParse(input);
    return parsed.success ? parsed.data : schema.parse(undefined);
  };
  const normalized: CardProfile = {
    accentColor: field(cardProfileSchema.shape.accentColor, source.accentColor),
    thumbnailImageUrl: field(cardProfileSchema.shape.thumbnailImageUrl, source.thumbnailImageUrl),
    onlineEmojiId: field(cardProfileSchema.shape.onlineEmojiId, source.onlineEmojiId),
    offlineEmojiId: field(cardProfileSchema.shape.offlineEmojiId, source.offlineEmojiId),
    warningEmojiId: field(cardProfileSchema.shape.warningEmojiId, source.warningEmojiId),
    pendingEmojiId: field(cardProfileSchema.shape.pendingEmojiId, source.pendingEmojiId),
    templates: Object.fromEntries(
      CARD_TEMPLATE_FIELDS.map((key) => [
        key,
        field(
          templateFieldSchema.shape[key],
          sanitizePersistedTemplate((source.templates as Record<string, unknown> | null)?.[key]),
        ),
      ]),
    ) as CardProfile['templates'],
    ...normalizeTextLines(source.textLines),
    ...(typeof source.mapArtwork === 'boolean' ? { mapArtwork: source.mapArtwork } : {}),
    visibleFields: field(cardProfileSchema.shape.visibleFields, source.visibleFields),
    statusLabels: field(cardProfileSchema.shape.statusLabels, source.statusLabels),
    fieldOrder: field(cardProfileSchema.shape.fieldOrder, source.fieldOrder),
    buttons: field(cardProfileSchema.shape.buttons, source.buttons),
    ...(source.layout === undefined
      ? {}
      : (() => {
          const raw = source.layout as { version?: unknown; elements?: unknown };
          const migrated =
            (raw.version === 1 || raw.version === CARD_LAYOUT_VERSION) &&
            Array.isArray(raw.elements)
              ? (() => {
                  const elements = raw.elements.map((value: unknown) => {
                    if (value === null || typeof value !== 'object' || Array.isArray(value))
                      return value;
                    const element = value as Record<string, unknown>;
                    if (element.type !== 'updates') return element;
                    const defaults = defaultUpdatesElement(stableLayoutId('community-updates'));
                    if (defaults.type !== 'updates') return element;
                    return {
                      ...defaults,
                      ...element,
                      showHeading:
                        typeof element.showHeading === 'boolean' ? element.showHeading : true,
                      feedOrder: Array.isArray(element.feedOrder)
                        ? element.feedOrder
                        : defaults.feedOrder,
                      separator:
                        typeof element.separator === 'object' && element.separator !== null
                          ? { ...defaults.separator, ...element.separator }
                          : defaults.separator,
                      announcements: {
                        ...defaults.announcements,
                        ...(typeof element.announcements === 'object' &&
                        element.announcements !== null
                          ? element.announcements
                          : {}),
                      },
                      changelog: {
                        ...defaults.changelog,
                        ...(typeof element.changelog === 'object' && element.changelog !== null
                          ? element.changelog
                          : {}),
                      },
                    };
                  });
                  if (
                    raw.version === 1 &&
                    !elements.some(
                      (element) =>
                        element !== null &&
                        typeof element === 'object' &&
                        !Array.isArray(element) &&
                        (element as Record<string, unknown>).type === 'updates',
                    )
                  ) {
                    const updates = {
                      ...defaultUpdatesElement(stableLayoutId('community-updates')),
                      visible:
                        (source.visibleFields as Record<string, unknown> | undefined)?.updates !==
                        false,
                    };
                    const oldSeparator = elements.findIndex(
                      (element) =>
                        element !== null &&
                        typeof element === 'object' &&
                        !Array.isArray(element) &&
                        (element as Record<string, unknown>).type === 'separator' &&
                        (element as Record<string, unknown>).label === 'Updates separator',
                    );
                    if (oldSeparator >= 0 && elements.length < 35)
                      elements.splice(oldSeparator + 1, 0, updates);
                    else if (oldSeparator >= 0) elements.splice(oldSeparator, 1, updates);
                    else if (elements.length < 35) elements.push(updates);
                  }
                  return { version: CARD_LAYOUT_VERSION, elements };
                })()
              : source.layout;
          const parsed = cardLayoutSchema.safeParse(migrated);
          return parsed.success ? { layout: parsed.data } : {};
        })()),
  };
  return normalized;
}

/** Stable legacy projection; generated IDs remain deterministic and do not create DB writes. */
export function resolveCardLayout(
  value: unknown,
  legacyDescription?: string | null,
): CardLayoutElement[] {
  const profile = normalizeCardProfile(value);
  if (profile.layout !== undefined) return profile.layout.elements;
  const lines = resolveCardLines(value, legacyDescription);
  const stableId = (key: string) => {
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, '0').slice(-12)}`;
  };
  const element = (key: string, data: CardLayoutElement): CardLayoutElement => ({
    ...data,
    id: stableId(key),
  });
  const header = lines.slice(0, 3);
  const headerText =
    header
      .map((line) => {
        if (!line.visible || !line.template.trim()) return '';
        const prefix = { large: '# ', medium: '## ', small: '### ', normal: '', subtext: '-# ' }[
          line.style
        ];
        return prefix + line.template.replace(/^(?:#{1,3}|-#)\s+/, '');
      })
      .filter(Boolean)
      .join('\n') || '\u200b';
  const layout: CardLayoutElement[] = [
    element('header', {
      id: '',
      type: 'section',
      label: 'Header and thumbnail',
      visible: true,
      template: headerText,
      style: 'normal',
      thumbnailUrl: profile.thumbnailImageUrl,
    }),
  ];
  for (let index = 3; index < 6; index++) {
    const line = lines[index];
    if (index === 4 && (profile.mapArtwork ?? profile.visibleFields.currentMap))
      layout.push(
        element('map-separator', {
          id: '',
          type: 'separator',
          label: 'Map separator',
          visible: true,
          divider: true,
          spacing: 1,
        }),
      );
    if (line?.visible)
      layout.push(
        element(`text-${line.id}`, {
          id: '',
          type: 'text',
          label: `Card ${line.id}`,
          visible: true,
          template: line.template,
          style: line.style,
        }),
      );
    if (index === 4 && (profile.mapArtwork ?? profile.visibleFields.currentMap))
      layout.push(
        element('map-gallery', {
          id: '',
          type: 'gallery',
          label: 'Map artwork',
          visible: true,
          items: [
            {
              id: stableId('map-image'),
              source: 'map',
              url: null,
              description: '{currentmap} map artwork',
            },
          ],
        }),
      );
  }
  if (profile.buttons.connect || profile.buttons.mapRules)
    layout.push(
      element('actions', { id: '', type: 'actions', label: 'Server actions', visible: true }),
    );
  layout.push(
    element('updates-separator', {
      id: '',
      type: 'separator',
      label: 'Updates separator',
      visible: true,
      divider: true,
      spacing: 1,
    }),
  );
  if (profile.visibleFields.updates)
    layout.push(
      element('community-updates', defaultUpdatesElement(stableLayoutId('community-updates'))),
    );
  return layout;
}

function stableLayoutId(key: string): string {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${hex.padStart(12, '0').slice(-12)}`;
}

function sanitizePersistedTemplate(value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(/\{([^{}]+)\}/g, (match: string) =>
        validateCardTemplate(match).length ? '' : match,
      )
    : value;
}

function normalizeTextLines(value: unknown): { textLines?: CardLine[] } {
  if (!Array.isArray(value) || value.length !== 6) return {};
  const ids = value.map((line: unknown) =>
    line !== null && typeof line === 'object' ? (line as Record<string, unknown>).id : undefined,
  );
  if (new Set(ids).size !== 6 || ids.some((id) => !CARD_LINE_IDS.includes(id as CardLine['id'])))
    return {};
  return {
    textLines: value.map((line: Record<string, unknown>) => {
      const id = line.id as CardLine['id'];
      return {
        id,
        template: validatedTemplate().safeParse(sanitizePersistedTemplate(line.template)).success
          ? (sanitizePersistedTemplate(line.template) as string)
          : DEFAULT_CARD_TEMPLATES[id],
        visible: typeof line.visible === 'boolean' ? line.visible : true,
        style: z.enum(CARD_LINE_STYLES).safeParse(line.style).success
          ? (line.style as CardLineStyle)
          : DEFAULT_CARD_LINE_STYLES[id],
      };
    }),
  };
}

/** Materializes six generic lines without persisting a migration or changing legacy rendering. */
export function resolveCardLines(
  profileValue: unknown,
  legacyDescription?: string | null,
): CardLine[] {
  const profile = normalizeCardProfile(profileValue);
  if (profile.textLines !== undefined) return profile.textLines;
  const hasTemplates =
    profileValue !== null &&
    typeof profileValue === 'object' &&
    Object.hasOwn(profileValue, 'templates');
  return (['title', 'subtitle', 'playerCount', ...profile.fieldOrder] as const).map((id) => ({
    id,
    template:
      id === 'description' && !hasTemplates && legacyDescription?.trim()
        ? legacyDescription.trim()
        : id === 'subtitle' && profile.templates.subtitle === DEFAULT_CARD_TEMPLATES.subtitle
          ? '{statusicon} {status} \u00b7 {location}'
          : profile.templates[id],
    visible: profile.visibleFields[id],
    style: DEFAULT_CARD_LINE_STYLES[id],
  }));
}

export function isHttpsUrl(value: string | null | undefined): value is string {
  if (value === undefined || value === null || value === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function environmentEmoji(name: string): string | null {
  const value = process.env[name]?.trim();
  return value !== undefined && /^\d{17,20}$/.test(value) ? value : null;
}

/** Resolves nullable overrides against validated environment settings and legacy assets. */
export function resolveCardProfile(value: unknown): ResolvedCardProfile {
  const profile = normalizeCardProfile(value);
  return {
    ...profile,
    thumbnailImageUrl: profile.thumbnailImageUrl ?? DEFAULT_THUMBNAIL_IMAGE_URL,
    onlineEmojiId: profile.onlineEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_ONLINE_ID'),
    offlineEmojiId: profile.offlineEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_OFFLINE_ID'),
    warningEmojiId: profile.warningEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_WARNING_ID'),
    pendingEmojiId: profile.pendingEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_PENDING_ID'),
  };
}

export function cardAccentColor(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}
