import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const actionSchema = z.enum(['OPEN', 'MODAL', 'REVIEW', 'OTHER', 'RESOLVE', 'REJECT']);
const snowflakeSchema = z.string().regex(/^\d{17,20}$/);
const uuidSchema = z.uuid();

const payloadSchema = z.object({
  action: actionSchema,
  guildId: snowflakeSchema,
  actorDiscordUserId: snowflakeSchema,
  targetDiscordUserId: snowflakeSchema.optional(),
  steamId64: z.string().optional(),
  disputeId: uuidSchema.optional(),
});
export type SteamAccountComponentPayload = z.infer<typeof payloadSchema>;

export function createSteamAccountCustomId(
  payload: SteamAccountComponentPayload,
  secret: string,
): string {
  const parsed = payloadSchema.parse(payload);
  const extras: string[] = [];
  if (parsed.targetDiscordUserId !== undefined) extras.push(parsed.targetDiscordUserId);
  if (parsed.steamId64 !== undefined) extras.push(parsed.steamId64);
  if (parsed.disputeId !== undefined) extras.push(parsed.disputeId.replaceAll('-', ''));
  const extrasSegment = extras.join(':');
  const body = `${parsed.action}:${parsed.guildId}:${parsed.actorDiscordUserId}${extrasSegment ? `:${extrasSegment}` : ''}`;
  const id = `tms:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord steam-account component ID exceeds 100 characters');
  return id;
}

export function parseSteamAccountCustomId(
  customId: string,
  secret: string,
): SteamAccountComponentPayload {
  const parts = customId.split(':');
  // tms:ACTION:guildId:actor:[extras]:signature
  if (parts.length < 5 || parts[0] !== 'tms') throw new Error('Invalid steam-account component ID');
  const signature = parts.at(-1);
  if (signature === undefined) throw new Error('Invalid steam-account component ID');
  const action = parts[1];
  const guildId = parts[2];
  const actor = parts[3];
  if (action === undefined || guildId === undefined || actor === undefined) {
    throw new Error('Invalid steam-account component ID');
  }
  const extrasStart = 4;
  const extrasEnd = parts.length - 1;
  const extrasParts = parts.slice(extrasStart, extrasEnd);
  const extras = extrasParts.length > 0 ? extrasParts.join(':') : '';

  const body = `${action}:${guildId}:${actor}${extras ? `:${extras}` : ''}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid steam-account component signature');

  const parsedAction = actionSchema.parse(action);
  const parsed: SteamAccountComponentPayload = {
    action: parsedAction,
    guildId,
    actorDiscordUserId: actor,
  };

  if (extras !== '') {
    if (parsedAction === 'RESOLVE' || parsedAction === 'REJECT') {
      parsed.disputeId = compactUuid(extras);
    } else if (parsedAction === 'REVIEW') {
      const [target, steamId64] = extras.split(':');
      if (target !== undefined && target !== '') parsed.targetDiscordUserId = target;
      if (steamId64 !== undefined) parsed.steamId64 = steamId64;
    }
  }
  return payloadSchema.parse(parsed);
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-steam-account\0')
    .update(body)
    .digest('base64url')
    .slice(0, 10);
}

function compactUuid(value: string): string {
  if (!/^[a-f0-9]{32}$/u.test(value)) throw new Error('Invalid compact UUID');
  return value.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
}
