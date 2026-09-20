import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  action: z.enum(['RB', 'RX', 'RP', 'RC', 'CA', 'CC']),
  matchId: z.uuid(),
  version: z.number().int().nonnegative(),
  phaseGeneration: z.number().int().nonnegative(),
  actorDiscordUserId: z.string().regex(/^\d{17,20}$/),
  expiresAt: z.number().int().nonnegative(),
});
export type MatchAdminComponentPayload = z.infer<typeof schema>;

export function createMatchAdminCustomId(
  payload: MatchAdminComponentPayload,
  secret: string,
): string {
  const parsed = schema.parse(payload);
  const body = [
    parsed.action,
    parsed.matchId.replaceAll('-', ''),
    parsed.version.toString(36),
    parsed.phaseGeneration.toString(36),
    parsed.actorDiscordUserId,
    parsed.expiresAt.toString(36),
  ].join(':');
  const id = `tma2:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord match-admin component ID exceeds 100 characters');
  return id;
}

export function parseMatchAdminCustomId(
  customId: string,
  secret: string,
  now = Date.now(),
): MatchAdminComponentPayload {
  const [prefix, action, compactMatchId, version, generation, actor, expiry, signature, extra] =
    customId.split(':');
  if (
    prefix !== 'tma2' ||
    action === undefined ||
    compactMatchId === undefined ||
    version === undefined ||
    generation === undefined ||
    actor === undefined ||
    expiry === undefined ||
    signature === undefined ||
    extra !== undefined ||
    !/^[a-f0-9]{32}$/u.test(compactMatchId)
  ) {
    throw new Error('Invalid match-admin component ID');
  }
  const body = [action, compactMatchId, version, generation, actor, expiry].join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid match-admin component signature');
  const matchId = compactMatchId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
  const payload = schema.parse({
    action,
    matchId,
    version: Number.parseInt(version, 36),
    phaseGeneration: Number.parseInt(generation, 36),
    actorDiscordUserId: actor,
    expiresAt: Number.parseInt(expiry, 36),
  });
  if (payload.expiresAt * 1000 < now) throw new Error('Match-admin component expired');
  return payload;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-match-admin-v2\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
