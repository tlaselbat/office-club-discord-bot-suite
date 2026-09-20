import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  action: z.enum(['RS', 'RC']),
  guildId: z.string().regex(/^\d{17,20}$/),
  targetDiscordUserId: z.string().regex(/^\d{17,20}$/),
  actorDiscordUserId: z.string().regex(/^\d{17,20}$/),
  expiresAt: z.number().int().nonnegative(),
});
export type PlayerAdminComponentPayload = z.infer<typeof schema>;

export function createPlayerAdminCustomId(
  payload: PlayerAdminComponentPayload,
  secret: string,
): string {
  const parsed = schema.parse(payload);
  const body = [
    parsed.action,
    parsed.guildId,
    parsed.targetDiscordUserId,
    parsed.actorDiscordUserId,
    parsed.expiresAt.toString(36),
  ].join(':');
  const id = `tps2:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord player-admin component ID exceeds 100 characters');
  return id;
}

export function parsePlayerAdminCustomId(
  customId: string,
  secret: string,
  now = Date.now(),
): PlayerAdminComponentPayload {
  const [
    prefix,
    action,
    guildId,
    targetDiscordUserId,
    actorDiscordUserId,
    expiry,
    signature,
    extra,
  ] = customId.split(':');
  if (
    prefix !== 'tps2' ||
    action === undefined ||
    guildId === undefined ||
    targetDiscordUserId === undefined ||
    actorDiscordUserId === undefined ||
    expiry === undefined ||
    signature === undefined ||
    extra !== undefined
  )
    throw new Error('Invalid player-admin component ID');
  const body = [action, guildId, targetDiscordUserId, actorDiscordUserId, expiry].join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid player-admin component signature');
  const payload = schema.parse({
    action,
    guildId,
    targetDiscordUserId,
    actorDiscordUserId,
    expiresAt: Number.parseInt(expiry, 36),
  });
  if (payload.expiresAt * 1000 < now) throw new Error('Player-admin component expired');
  return payload;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-player-admin-v2\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
