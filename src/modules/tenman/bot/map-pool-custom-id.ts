import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.enum(['VIEW', 'ADD', 'ADD_SUBMIT', 'POOL', 'REMOVE', 'PREVIOUS', 'NEXT']),
  guildId: z.string().regex(/^\d{17,20}$/),
  actorDiscordUserId: z.string().regex(/^\d{17,20}$/),
  settingsVersion: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
  expiresAt: z.number().int(),
});

export type MapPoolComponentPayload = z.infer<typeof payloadSchema>;

export function createMapPoolCustomId(payload: MapPoolComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const body = [
    '1',
    parsed.action,
    parsed.guildId,
    parsed.actorDiscordUserId,
    parsed.settingsVersion.toString(36),
    parsed.page.toString(36),
    parsed.expiresAt.toString(36),
  ].join(':');
  return `tqmp:${body}:${sign(body, secret)}`;
}

export function parseMapPoolCustomId(customId: string, secret: string): MapPoolComponentPayload {
  const [
    namespace,
    version,
    action,
    guildId,
    actorDiscordUserId,
    settingsVersion,
    page,
    expiresAt,
    signature,
    extra,
  ] = customId.split(':');
  if (
    namespace !== 'tqmp' ||
    version !== '1' ||
    action === undefined ||
    guildId === undefined ||
    actorDiscordUserId === undefined ||
    settingsVersion === undefined ||
    page === undefined ||
    expiresAt === undefined ||
    signature === undefined ||
    extra !== undefined
  ) {
    throw new Error('Invalid map-pool component ID');
  }
  const body = [
    version,
    action,
    guildId,
    actorDiscordUserId,
    settingsVersion,
    page,
    expiresAt,
  ].join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid map-pool component signature');
  const payload = payloadSchema.parse({
    action,
    guildId,
    actorDiscordUserId,
    settingsVersion: Number.parseInt(settingsVersion, 36),
    page: Number.parseInt(page, 36),
    expiresAt: Number.parseInt(expiresAt, 36),
  });
  if (payload.expiresAt * 1000 < Date.now()) throw new Error('Map-pool control expired');
  return payload;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-map-pool\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
