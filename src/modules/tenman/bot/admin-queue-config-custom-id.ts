import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.enum(['TEAM', 'MAP', 'LOCATION', 'SAVE', 'CANCEL']),
  guildId: z.string().regex(/^\d{17,20}$/),
  actorDiscordUserId: z.string().regex(/^\d{17,20}$/),
  settingsVersion: z.number().int().nonnegative(),
  team: z.enum(['C', 'S']),
  map: z.enum(['V', 'R']),
  location: z.enum(['D', 'L', 'V']),
});

export type AdminQueueConfigPayload = z.infer<typeof payloadSchema>;

export function createAdminQueueConfigCustomId(
  payload: AdminQueueConfigPayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const body = [
    '1',
    parsed.action,
    parsed.guildId,
    parsed.actorDiscordUserId,
    parsed.settingsVersion.toString(36),
    parsed.team,
    parsed.map,
    parsed.location,
  ].join(':');
  return `tqc:${body}:${sign(body, secret)}`;
}

export function parseAdminQueueConfigCustomId(
  customId: string,
  secret: string,
): AdminQueueConfigPayload {
  const [namespace, version, action, guildId, actorDiscordUserId, encodedVersion, team, map, location, signature, extra] =
    customId.split(':');
  if (
    namespace !== 'tqc' ||
    version !== '1' ||
    action === undefined ||
    guildId === undefined ||
    actorDiscordUserId === undefined ||
    encodedVersion === undefined ||
    team === undefined ||
    map === undefined ||
    location === undefined ||
    signature === undefined ||
    extra !== undefined
  ) {
    throw new Error('Invalid queue configuration component ID');
  }
  const body = [version, action, guildId, actorDiscordUserId, encodedVersion, team, map, location].join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid queue configuration component signature');
  return payloadSchema.parse({
    action,
    guildId,
    actorDiscordUserId,
    settingsVersion: Number.parseInt(encodedVersion, 36),
    team,
    map,
    location,
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-admin-queue-config\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
