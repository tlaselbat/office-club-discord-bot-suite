import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { decodeUuid, encodeUuid } from './compact-uuid.js';

const actionSchema = z.enum(['REPORT', 'MODAL', 'RES', 'RSM']);
const resolutionSchema = z.enum(['REJECT', 'REVERSE']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);
const uuidishSchema = z
  .string()
  .transform((value) => (/^[a-f0-9]{32}$/u.test(value) ? expandMatchUuid(value) : value))
  .pipe(z.uuid());

const payloadSchema = z.object({
  action: actionSchema,
  guildId: snowflakeSchema,
  actorDiscordUserId: snowflakeSchema,
  matchId: uuidishSchema.optional(),
  disputeId: uuidishSchema.optional(),
  resolution: resolutionSchema.optional(),
});
export type MatchResultDisputePayload = z.infer<typeof payloadSchema>;

const GAP = '-';

export function createResultDisputeCustomId(
  payload: MatchResultDisputePayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const extras = [
    parsed.matchId === undefined ? GAP : encodeUuid(parsed.matchId),
    parsed.disputeId === undefined ? GAP : encodeUuid(parsed.disputeId),
    parsed.resolution === undefined ? GAP : parsed.resolution,
  ];
  while (extras.length > 0 && extras[extras.length - 1] === GAP) extras.pop();
  const body = [parsed.action, parsed.guildId, parsed.actorDiscordUserId, ...extras].join(':');
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
  const namespace = parts[0];
  const signature = parts[parts.length - 1];
  const bodyParts = parts.slice(1, -1);
  if (namespace !== 'tmd' || signature === undefined || bodyParts.length < 3)
    throw new Error('Invalid result-dispute component ID');
  const body = bodyParts.join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid result-dispute component signature');
  const [action, guildId, actor, encodedMatchId, encodedDisputeId, resolution] = bodyParts;
  if (action === undefined || guildId === undefined || actor === undefined)
    throw new Error('Invalid result-dispute component ID');
  return payloadSchema.parse({
    action,
    guildId,
    actorDiscordUserId: actor,
    ...(encodedMatchId === undefined || encodedMatchId === GAP
      ? {}
      : { matchId: decodeUuid(encodedMatchId) }),
    ...(encodedDisputeId === undefined || encodedDisputeId === GAP
      ? {}
      : { disputeId: decodeUuid(encodedDisputeId) }),
    ...(resolution === undefined || resolution === GAP ? {} : { resolution }),
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
