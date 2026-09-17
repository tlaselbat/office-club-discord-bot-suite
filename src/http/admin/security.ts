import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sessionCookieName = '__Secure-tenman_admin';
export const stateCookieName = '__Secure-tenman_oauth_state';

export function createOAuthState(secret: string, now = Date.now()): string {
  const payload = `${randomBytes(24).toString('base64url')}.${String(Math.floor(now / 1000))}`;
  return `${payload}.${sign(secret, 'oauth-state', payload)}`;
}

export function verifyOAuthState(secret: string, value: string, now = Date.now()): boolean {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [nonce, issued, signature] = parts;
  if (nonce === undefined || issued === undefined || signature === undefined) return false;
  const issuedAt = Number(issued) * 1000;
  if (!Number.isFinite(issuedAt) || issuedAt > now || now - issuedAt > 10 * 60 * 1000) return false;
  return equal(signature, sign(secret, 'oauth-state', `${nonce}.${issued}`));
}

export function csrfToken(secret: string, sessionToken: string): string {
  return sign(secret, 'csrf', sessionToken);
}

export function verifyCsrf(secret: string, sessionToken: string, token: string): boolean {
  return equal(token, csrfToken(secret, sessionToken));
}

function sign(secret: string, domain: string, value: string): string {
  return createHmac('sha256', secret).update(`${domain}\0${value}`).digest('base64url');
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
