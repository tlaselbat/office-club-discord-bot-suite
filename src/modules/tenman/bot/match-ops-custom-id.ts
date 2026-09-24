import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { decodeUuid, encodeUuid } from './compact-uuid.js';

const actionSchema = z.enum(['FR', 'RP', 'ST', 'RO', 'RI', 'RB', 'RF']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);

const payloadSchema = z.object({
  action: actionSchema,
  matchId: z.uuid(),
  version: z.number().int().nonnegative(),
  phaseGeneration: z.number().int().nonnegative(),
  actorDiscordUserId: snowflakeSchema,
  expiresAt: z.date(),
  targetDiscordUserId: snowflakeSchema.optional(),
});
export type MatchOpsComponentPayload = z.infer<typeof payloadSchema>;

export function createMatchOpsCustomId(payload: MatchOpsComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const expiry = Math.floor(parsed.expiresAt.getTime() / 1000).toString(36);
  const extra = parsed.targetDiscordUserId === undefined ? '' : `:${parsed.targetDiscordUserId}`;
  const body = `${parsed.action}:${encodeUuid(parsed.matchId)}:${parsed.version.toString(36)}:${parsed.phaseGeneration.toString(36)}:${parsed.actorDiscordUserId}:${expiry}${extra}`;
  const id = `tmo:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord match-ops component ID exceeds 100 characters');
  return id;
}

export function parseMatchOpsCustomId(customId: string, secret: string): MatchOpsComponentPayload {
  const parts = customId.split(':');
  const namespace = parts[0];
  const signature = parts[parts.length - 1];
  const bodyParts = parts.slice(1, -1);
  if (
    namespace !== 'tmo' ||
    signature === undefined ||
    (bodyParts.length !== 6 && bodyParts.length !== 7)
  )
    throw new Error('Invalid match-ops component ID');
  const [
    action,
    encodedId,
    encodedVersion,
    encodedGeneration,
    actorDiscordUserId,
    encodedExpiry,
    targetDiscordUserId,
  ] = bodyParts;
  if (
    action === undefined ||
    encodedId === undefined ||
    encodedVersion === undefined ||
    encodedGeneration === undefined ||
    actorDiscordUserId === undefined ||
    encodedExpiry === undefined
  )
    throw new Error('Invalid match-ops component ID');
  const body = bodyParts.join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid match-ops component signature');
  const expiresAt = new Date(Number.parseInt(encodedExpiry, 36) * 1000);
  if (expiresAt.getTime() < Date.now()) throw new Error('Match-ops component has expired');
  return payloadSchema.parse({
    action,
    matchId: decodeUuid(encodedId),
    version: Number.parseInt(encodedVersion, 36),
    phaseGeneration: Number.parseInt(encodedGeneration, 36),
    actorDiscordUserId,
    expiresAt,
    ...(targetDiscordUserId === undefined ? {} : { targetDiscordUserId }),
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-match-ops\0')
    .update(body)
    .digest('base64url')
    .slice(0, 10);
}
