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

/** Persisted card presentation overrides. Null image and emoji values inherit their legacy defaults. */
export const cardProfileSchema = z.object({
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
  return {
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
  };
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
