/** Encodes a UUID as 22-character base64url so signed custom IDs stay under 100 chars. */
export function encodeUuid(uuid: string): string {
  const hex = uuid.replaceAll('-', '');
  if (!/^[a-f0-9]{32}$/u.test(hex)) throw new Error('Invalid UUID');
  return Buffer.from(hex, 'hex').toString('base64url');
}

export function decodeUuid(encoded: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(encoded)) throw new Error('Invalid encoded UUID');
  const hex = Buffer.from(encoded, 'base64url').toString('hex');
  if (!/^[a-f0-9]{32}$/u.test(hex)) throw new Error('Invalid encoded UUID');
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');
}
