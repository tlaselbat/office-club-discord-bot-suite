import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const actionSchema = z.enum(['HUB', 'HISTORY', 'STATS']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);

const payloadSchema = z.object({
  action: actionSchema,
  guildId: snowflakeSchema,
  actorDiscordUserId: snowflakeSchema,
});
export type PlayerHubComponentPayload = z.infer<typeof payloadSchema>;

export function createPlayerHubCustomId(
  payload: PlayerHubComponentPayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const body = `${parsed.action}:${parsed.guildId}:${parsed.actorDiscordUserId}`;
  const id = `tmp:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord player-hub component ID exceeds 100 characters');
  return id;
}

export function parsePlayerHubCustomId(
  customId: string,
  secret: string,
): PlayerHubComponentPayload {
  const parts = customId.split(':');
  if (parts.length !== 5 || parts[0] !== 'tmp')
    throw new Error('Invalid player-hub component namespace');
  const [, action, guildId, actorDiscordUserId, signature] = parts;
  if (
    action === undefined ||
    guildId === undefined ||
    actorDiscordUserId === undefined ||
    signature === undefined
  )
    throw new Error('Invalid player-hub component ID');
  const body = `${action}:${guildId}:${actorDiscordUserId}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid player-hub component signature');
  return payloadSchema.parse({ action, guildId, actorDiscordUserId });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-player-hub\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
