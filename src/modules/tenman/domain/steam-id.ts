const steamId64Pattern = /^7656119\d{10}$/;

export function isSteamId64(value: string): boolean {
  if (!steamId64Pattern.test(value)) return false;
  const id = BigInt(value);
  return id >= 76561197960265728n && id <= 76561202255233023n;
}

export function assertSteamId64(value: string): void {
  if (!isSteamId64(value)) throw new Error('Invalid SteamID64');
}
