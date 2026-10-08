import { z } from 'zod';

export const DEFAULT_CARD_ACCENT_COLOR = '#2b8aef';
export const DEFAULT_CARD_DESCRIPTION =
  'Challenge other players 1v1, warm up, or kill time between matches.\n-# Open to all Office Club members.';
export const DEFAULT_THUMBNAIL_IMAGE_URL =
  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-thumbnail.png';

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', 'Must use HTTPS');
const emojiId = z.string().regex(/^\d{17,20}$/, 'Must be a Discord emoji ID');

/** Persisted card presentation overrides. Null image and emoji values inherit their legacy defaults. */
export const cardProfileSchema = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default(DEFAULT_CARD_ACCENT_COLOR),
  thumbnailImageUrl: httpsUrl.nullable().default(null),
  onlineEmojiId: emojiId.nullable().default(null),
  offlineEmojiId: emojiId.nullable().default(null),
  warningEmojiId: emojiId.nullable().default(null),
  pendingEmojiId: emojiId.nullable().default(null),
});

export type CardProfile = z.infer<typeof cardProfileSchema>;

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
  };
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
