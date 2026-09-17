import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const actionSchema = z.enum(['TC', 'TX', 'RA', 'RX']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);

export interface AdminComponentPayload {
  action: z.infer<typeof actionSchema>;
  guildId: string;
  actorDiscordUserId: string;
  settingsVersion: number;
  generation: string;
  expiresAt: number;
}

export function createAdminCustomId(payload: AdminComponentPayload, secret: string): string {
  const parsed = parsePayload(payload);
  const body = [
    '1',
    parsed.action,
    parsed.guildId,
    parsed.actorDiscordUserId,
    parsed.settingsVersion.toString(36),
    parsed.generation,
    parsed.expiresAt.toString(36),
  ].join(':');
  const customId = `tma:${body}:${sign(body, secret)}`;
  if (customId.length > 100) throw new Error('Discord admin custom ID exceeds 100 characters');
  return customId;
}

export function parseAdminCustomId(
  customId: string,
  secret: string,
  now = Date.now(),
): AdminComponentPayload {
  const [
    namespace,
    version,
    action,
    guildId,
    actorDiscordUserId,
    encodedVersion,
    generation,
    encodedExpiry,
    signature,
    extra,
  ] = customId.split(':');
  if (
    namespace !== 'tma' ||
    version !== '1' ||
    action === undefined ||
    guildId === undefined ||
    actorDiscordUserId === undefined ||
    encodedVersion === undefined ||
    generation === undefined ||
    encodedExpiry === undefined ||
    signature === undefined ||
    extra !== undefined
  ) {
    throw new Error('Invalid admin component ID');
  }
  const body = [
    version,
    action,
    guildId,
    actorDiscordUserId,
    encodedVersion,
    generation,
    encodedExpiry,
  ].join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error('Invalid admin component signature');
  }
  const payload = parsePayload({
    action,
    guildId,
    actorDiscordUserId,
    settingsVersion: Number.parseInt(encodedVersion, 36),
    generation,
    expiresAt: Number.parseInt(encodedExpiry, 36),
  });
  if (payload.expiresAt * 1000 < now) throw new Error('Admin component expired');
  return payload;
}

export function adminGeneration(attemptId: string | null, settingsVersion: number): string {
  return createHmac('sha256', '10man-admin-generation')
    .update(`${attemptId ?? 'none'}:${String(settingsVersion)}`)
    .digest('base64url')
    .slice(0, 8)
    .toLowerCase();
}

function parsePayload(value: unknown): AdminComponentPayload {
  return z
    .object({
      action: actionSchema,
      guildId: snowflakeSchema,
      actorDiscordUserId: snowflakeSchema,
      settingsVersion: z.number().int().nonnegative(),
      generation: z.string().regex(/^[a-z0-9_-]{1,12}$/),
      expiresAt: z.number().int().nonnegative(),
    })
    .parse(value);
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-admin-v1\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
