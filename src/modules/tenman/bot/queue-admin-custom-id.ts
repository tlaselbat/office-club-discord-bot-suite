import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const actionSchema = z.enum(['BAN_SELECT', 'BAN_MODAL', 'UNBAN']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);

const payloadSchema = z.object({
  action: actionSchema,
  guildId: snowflakeSchema,
  actorDiscordUserId: snowflakeSchema,
  expiresAt: z.date(),
  targetDiscordUserId: snowflakeSchema.optional(),
});
export type QueueAdminComponentPayload = z.infer<typeof payloadSchema>;

export function createQueueAdminCustomId(
  payload: QueueAdminComponentPayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const expiry = Math.floor(parsed.expiresAt.getTime() / 1000).toString(36);
  const extra = parsed.targetDiscordUserId === undefined ? '' : `:${parsed.targetDiscordUserId}`;
  const body = `${parsed.action}:${parsed.guildId}:${parsed.actorDiscordUserId}:${expiry}${extra}`;
  const id = `tqb:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord queue-admin component ID exceeds 100 characters');
  return id;
}

export function parseQueueAdminCustomId(
  customId: string,
  secret: string,
): QueueAdminComponentPayload {
  const parts = customId.split(':');
  const namespace = parts[0];
  const signature = parts[parts.length - 1];
  const bodyParts = parts.slice(1, -1);
  if (
    namespace !== 'tqb' ||
    signature === undefined ||
    (bodyParts.length !== 4 && bodyParts.length !== 5)
  )
    throw new Error('Invalid queue-admin component ID');
  const [action, guildId, actorDiscordUserId, encodedExpiry, targetDiscordUserId] = bodyParts;
  if (
    action === undefined ||
    guildId === undefined ||
    actorDiscordUserId === undefined ||
    encodedExpiry === undefined
  )
    throw new Error('Invalid queue-admin component ID');
  const body = bodyParts.join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid queue-admin component signature');
  const expiresAt = new Date(Number.parseInt(encodedExpiry, 36) * 1000);
  if (expiresAt.getTime() < Date.now()) throw new Error('Queue-admin component has expired');
  return payloadSchema.parse({
    action,
    guildId,
    actorDiscordUserId,
    expiresAt,
    ...(targetDiscordUserId === undefined ? {} : { targetDiscordUserId }),
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-queue-admin\0')
    .update(body)
    .digest('base64url')
    .slice(0, 10);
}
