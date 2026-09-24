import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const actionSchema = z.enum(['REPORT', 'MODAL']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);
const compactUuidSchema = z.string().regex(/^[a-f0-9]{32}$/);

const payloadSchema = z.object({
  action: actionSchema,
  guildId: snowflakeSchema,
  actorDiscordUserId: snowflakeSchema,
  matchId: compactUuidSchema,
});
export type MatchResultDisputePayload = z.infer<typeof payloadSchema>;

export function createResultDisputeCustomId(
  payload: MatchResultDisputePayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const compactMatchId = parsed.matchId;
  const body = `${parsed.action}:${parsed.guildId}:${parsed.actorDiscordUserId}:${compactMatchId}`;
  const id = `tmd:${body}:${sign(body, secret)}`;
  if (id.length > 100)
    throw new Error('Discord result-dispute component ID exceeds 100 characters');
  return id;
}

export function parseResultDisputeCustomId(
  customId: string,
  secret: string,
): MatchResultDisputePayload {
  const parts = customId.split(':');
  // tmd:ACTION:guildId:actor:matchId:signature
  if (parts.length !== 6 || parts[0] !== 'tmd') {
    throw new Error('Invalid result-dispute component ID');
  }
  const [, action, guildId, actor, compactMatchId, signature] = parts;
  if (
    action === undefined ||
    guildId === undefined ||
    actor === undefined ||
    compactMatchId === undefined ||
    signature === undefined
  ) {
    throw new Error('Invalid result-dispute component ID');
  }
  const body = `${action}:${guildId}:${actor}:${compactMatchId}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid result-dispute component signature');

  return payloadSchema.parse({
    action,
    guildId,
    actorDiscordUserId: actor,
    matchId: compactMatchId,
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-result-dispute\0')
    .update(body)
    .digest('base64url')
    .slice(0, 10);
}

export function compactMatchUuid(value: string): string {
  const cleaned = value.replaceAll('-', '');
  if (!/^[a-f0-9]{32}$/u.test(cleaned)) throw new Error('Invalid match UUID');
  return cleaned;
}

export function expandMatchUuid(value: string): string {
  if (!/^[a-f0-9]{32}$/u.test(value)) throw new Error('Invalid compact match UUID');
  return value.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
}
