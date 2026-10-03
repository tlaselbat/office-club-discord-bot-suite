import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.enum(['ADD', 'ADD_SUBMIT', 'POOL', 'REMOVE', 'PREVIOUS', 'NEXT']),
  guildId: z.string().regex(/^\d{17,20}$/),
  settingsVersion: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
});

export type MapPoolComponentPayload = z.infer<typeof payloadSchema>;

export function createMapPoolCustomId(payload: MapPoolComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const body = [
    '2',
    parsed.action,
    parsed.guildId,
    parsed.settingsVersion.toString(36),
    parsed.page.toString(36),
  ].join(':');
  return `tqmp:${body}:${sign(body, secret)}`;
}

export function parseMapPoolCustomId(customId: string, secret: string): MapPoolComponentPayload {
  const [namespace, version, action, guildId, settingsVersion, page, signature, extra] =
    customId.split(':');
  if (
    namespace !== 'tqmp' ||
    version !== '2' ||
    action === undefined ||
    guildId === undefined ||
    settingsVersion === undefined ||
    page === undefined ||
    signature === undefined ||
    extra !== undefined
  ) {
    throw new Error('Invalid map-pool component ID');
  }
  const body = [version, action, guildId, settingsVersion, page].join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid map-pool component signature');
  return payloadSchema.parse({
    action,
    guildId,
    settingsVersion: Number.parseInt(settingsVersion, 36),
    page: Number.parseInt(page, 36),
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-map-pool\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
