import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  action: z.enum(['ADD', 'REMOVE']),
  guildId: z.string().regex(/^\d{17,20}$/),
  actorDiscordUserId: z.string().regex(/^\d{17,20}$/),
  expiresAt: z.number().int(),
});
export type MatchModeratorComponentPayload = z.infer<typeof schema>;
export function createMatchModeratorCustomId(
  value: MatchModeratorComponentPayload,
  secret: string,
) {
  const parsed = schema.parse(value);
  const body = `${parsed.action}:${parsed.guildId}:${parsed.actorDiscordUserId}:${parsed.expiresAt.toString(36)}`;
  return `tqm:${body}:${sign(body, secret)}`;
}
export function parseMatchModeratorCustomId(
  id: string,
  secret: string,
): MatchModeratorComponentPayload {
  const [namespace, action, guildId, actorDiscordUserId, expiry, signature, extra] = id.split(':');
  if (
    namespace !== 'tqm' ||
    !action ||
    !guildId ||
    !actorDiscordUserId ||
    !expiry ||
    !signature ||
    extra
  )
    throw new Error('Invalid Match Moderator control');
  const body = `${action}:${guildId}:${actorDiscordUserId}:${expiry}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid Match Moderator control signature');
  const payload = schema.parse({
    action,
    guildId,
    actorDiscordUserId,
    expiresAt: Number.parseInt(expiry, 36),
  });
  if (payload.expiresAt * 1000 < Date.now()) throw new Error('Match Moderator control expired');
  return payload;
}
function sign(body: string, secret: string) {
  return createHmac('sha256', secret)
    .update('10man-match-moderator\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
