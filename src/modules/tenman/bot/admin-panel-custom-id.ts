import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.enum(['CONFIGURE', 'MODERATORS', 'MAPS', 'OPEN', 'CLOSE', 'REPAIR', 'REFRESH']),
  guildId: z.string().regex(/^\d{17,20}$/),
  version: z.number().int().nonnegative(),
});

export type AdminPanelComponentPayload = z.infer<typeof payloadSchema>;

export function createAdminPanelCustomId(
  payload: AdminPanelComponentPayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const body = `${parsed.action}:${parsed.guildId}:${parsed.version.toString(36)}`;
  return `tqa:${body}:${sign(body, secret)}`;
}

export function parseAdminPanelCustomId(
  customId: string,
  secret: string,
): AdminPanelComponentPayload {
  const [namespace, action, guildId, encodedVersion, signature, extra] = customId.split(':');
  if (
    namespace !== 'tqa' ||
    action === undefined ||
    guildId === undefined ||
    encodedVersion === undefined ||
    signature === undefined ||
    extra !== undefined
  )
    throw new Error('Invalid admin-panel component ID');
  const body = `${action}:${guildId}:${encodedVersion}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid admin-panel component signature');
  return payloadSchema.parse({ action, guildId, version: Number.parseInt(encodedVersion, 36) });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-admin-panel\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
