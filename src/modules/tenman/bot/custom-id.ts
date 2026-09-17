import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.string().regex(/^[A-Z0-9_]+$/),
  matchId: z.uuid(),
  version: z.number().int().nonnegative(),
  targetDiscordUserId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
});
export type ComponentPayload = z.infer<typeof payloadSchema>;

export function createCustomId(payload: ComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const target = parsed.targetDiscordUserId === undefined ? '' : `:${parsed.targetDiscordUserId}`;
  const body = `${parsed.action}:${parsed.matchId.replaceAll('-', '')}:${parsed.version.toString(36)}${target}`;
  const customId = `tm:${body}:${sign(body, secret)}`;
  if (customId.length > 100) throw new Error('Discord custom ID exceeds 100 characters');
  return customId;
}

export function parseCustomId(customId: string, secret: string): ComponentPayload {
  const parts = customId.split(':');
  if (parts[0] !== 'tm' || (parts.length !== 5 && parts.length !== 6)) {
    throw new Error('Invalid component ID');
  }
  const action = parts[1];
  const compactMatchId = parts[2];
  const encodedVersion = parts[3];
  const targetDiscordUserId = parts.length === 6 ? parts[4] : undefined;
  const signature = parts.at(-1);
  if (
    action === undefined ||
    compactMatchId === undefined ||
    encodedVersion === undefined ||
    signature === undefined
  ) {
    throw new Error('Invalid component ID');
  }
  const target = targetDiscordUserId === undefined ? '' : `:${targetDiscordUserId}`;
  const body = `${action}:${compactMatchId}:${encodedVersion}${target}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error('Invalid component signature');
  }
  if (!/^[a-f0-9]{32}$/u.test(compactMatchId) || !/^[0-9a-z]+$/u.test(encodedVersion)) {
    throw new Error('Invalid component payload');
  }
  const matchId = compactMatchId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
  return payloadSchema.parse({
    action,
    matchId,
    version: Number.parseInt(encodedVersion, 36),
    ...(targetDiscordUserId === undefined ? {} : { targetDiscordUserId }),
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url').slice(0, 16);
}
