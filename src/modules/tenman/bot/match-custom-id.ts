import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.string().regex(/^[A-Z0-9_]+$/),
  matchId: z.uuid(),
  version: z.number().int().nonnegative(),
  phaseGeneration: z.number().int().nonnegative(),
  targetDiscordUserId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
});
export type MatchComponentPayload = z.infer<typeof payloadSchema>;

export function createMatchCustomId(payload: MatchComponentPayload, secret: string): string {
  const parsed = payloadSchema.parse(payload);
  const target = parsed.targetDiscordUserId === undefined ? '' : `:${parsed.targetDiscordUserId}`;
  const body = `${parsed.action}:${parsed.matchId.replaceAll('-', '')}:${parsed.version.toString(36)}:${parsed.phaseGeneration.toString(36)}${target}`;
  const id = `tmm:${body}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Discord custom ID exceeds 100 characters');
  return id;
}

export function parseMatchCustomId(customId: string, secret: string): MatchComponentPayload {
  const parts = customId.split(':');
  if (parts[0] !== 'tmm' || (parts.length !== 6 && parts.length !== 7))
    throw new Error('Invalid match component ID');
  const [
    ,
    action,
    compactId,
    encodedVersion,
    encodedGeneration,
    possibleTarget,
    possibleSignature,
  ] = parts;
  const targetDiscordUserId = parts.length === 7 ? possibleTarget : undefined;
  const signature = parts.length === 7 ? possibleSignature : possibleTarget;
  if (
    action === undefined ||
    compactId === undefined ||
    encodedVersion === undefined ||
    encodedGeneration === undefined ||
    signature === undefined
  )
    throw new Error('Invalid match component ID');
  const target = targetDiscordUserId === undefined ? '' : `:${targetDiscordUserId}`;
  const body = `${action}:${compactId}:${encodedVersion}:${encodedGeneration}${target}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid match component signature');
  if (!/^[a-f0-9]{32}$/u.test(compactId)) throw new Error('Invalid match component ID');
  const matchId = compactId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
  return payloadSchema.parse({
    action,
    matchId,
    version: Number.parseInt(encodedVersion, 36),
    phaseGeneration: Number.parseInt(encodedGeneration, 36),
    ...(targetDiscordUserId === undefined ? {} : { targetDiscordUserId }),
  });
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('10man-match\0')
    .update(body)
    .digest('base64url')
    .slice(0, 16);
}
