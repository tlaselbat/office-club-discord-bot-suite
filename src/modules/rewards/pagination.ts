import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RewardPagePayload {
  guildId: string;
  requesterId: string;
  page: number;
  expiresAt: number;
}

export function buildRewardPageId(payload: RewardPagePayload, secret: string): string {
  const body = `${payload.guildId}:${payload.requesterId}:${String(payload.page)}:${String(payload.expiresAt)}`;
  return `rw:${body}:${sign(body, secret)}`;
}

export function parseRewardPageId(customId: string, secret: string): RewardPagePayload {
  const [prefix, guildId, requesterId, pageValue, expiresValue, signature] = customId.split(':');
  if (
    prefix !== 'rw' ||
    guildId === undefined ||
    requesterId === undefined ||
    pageValue === undefined ||
    expiresValue === undefined ||
    signature === undefined
  ) {
    throw new Error('Invalid rewards page control');
  }
  const body = `${guildId}:${requesterId}:${pageValue}:${expiresValue}`;
  const expected = sign(body, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error('Invalid rewards page signature');
  }
  const page = Number(pageValue);
  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(expiresAt)) {
    throw new Error('Invalid rewards page payload');
  }
  if (expiresAt < Math.floor(Date.now() / 1000)) throw new Error('Rewards page control expired');
  return { guildId, requesterId, page, expiresAt };
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`rewards-page:${body}`)
    .digest('base64url')
    .slice(0, 16);
}
