import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { decodeUuid, encodeUuid } from './compact-uuid.js';

const actionSchema = z.enum(['PANEL', 'CREATE', 'INVITE', 'KICK', 'LEAVE', 'DISBAND', 'ACCEPT']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);

const payloadSchema = z.object({
  action: actionSchema,
  guildId: snowflakeSchema,
  actorDiscordUserId: snowflakeSchema,
  partyId: z.uuid().optional(),
  inviteId: z.uuid().optional(),
});
export type PartyComponentPayload = z.infer<typeof payloadSchema>;

const GAP = '-';

export function createPartyCustomId(payload: PartyComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const extras = [
    parsed.partyId === undefined ? GAP : encodeUuid(parsed.partyId),
    parsed.inviteId === undefined ? GAP : encodeUuid(parsed.inviteId),
  ];
  while (extras.length > 0 && extras[extras.length - 1] === GAP) extras.pop();
  const body = [parsed.action, parsed.guildId, parsed.actorDiscordUserId, ...extras].join(':');
  const id = `tpy:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord party component ID exceeds 100 characters');
  return id;
}

export function parsePartyCustomId(customId: string, secret: string): PartyComponentPayload {
  const parts = customId.split(':');
  const namespace = parts[0];
  const signature = parts[parts.length - 1];
  const bodyParts = parts.slice(1, -1);
  if (
    namespace !== 'tpy' ||
    signature === undefined ||
    bodyParts.length < 3 ||
    bodyParts.length > 5
  )
    throw new Error('Invalid party component ID');
  const body = bodyParts.join(':');
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid party component signature');
  const [action, guildId, actorDiscordUserId, encodedPartyId, encodedInviteId] = bodyParts;
  if (action === undefined || guildId === undefined || actorDiscordUserId === undefined)
    throw new Error('Invalid party component ID');
  return payloadSchema.parse({
    action,
    guildId,
    actorDiscordUserId,
    ...(encodedPartyId === undefined || encodedPartyId === GAP
      ? {}
      : { partyId: decodeUuid(encodedPartyId) }),
    ...(encodedInviteId === undefined || encodedInviteId === GAP
      ? {}
      : { inviteId: decodeUuid(encodedInviteId) }),
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-party\0')
    .update(body)
    .digest('base64url')
    .slice(0, 10);
}
