import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.enum(['JOIN', 'LEAVE', 'LEAVE_CONFIRM', 'HOW_IT_WORKS', 'REFRESH']),
  guildId: z.string().regex(/^\d{17,20}$/),
  version: z.number().int().nonnegative(),
});
export type QueueComponentPayload = z.infer<typeof payloadSchema>;

export function createQueueCustomId(payload: QueueComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const body = `${parsed.action}:${parsed.guildId}:${parsed.version.toString(36)}`;
  return `tmq:${body}:${sign(body, secret)}`;
}

export function parseQueueCustomId(customId: string, secret: string): QueueComponentPayload {
  const [namespace, action, guildId, encodedVersion, signature, extra] = customId.split(':');
  if (
    namespace !== 'tmq' ||
    action === undefined ||
    guildId === undefined ||
    encodedVersion === undefined ||
    signature === undefined ||
    extra !== undefined
  )
    throw new Error('Invalid queue component ID');
  const body = `${action}:${guildId}:${encodedVersion}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid queue component signature');
  return payloadSchema.parse({ action, guildId, version: Number.parseInt(encodedVersion, 36) });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-queue\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
