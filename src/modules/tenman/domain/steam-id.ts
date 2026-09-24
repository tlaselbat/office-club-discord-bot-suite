const steamId64Pattern = /^7656119\d{10}$/;
const steam2Pattern = /^STEAM_([0-5]):([0-1]):(\d+)$/i;
const steam3Pattern = /^\[U:1:(\d+)\]$/i;
const profilesUrlPattern = /^(?:https?:\/\/)?steamcommunity\.com\/profiles\/(\d+)\/?$/i;
const idUrlPattern = /^(?:https?:\/\/)?steamcommunity\.com\/id\/([^/]+)\/?$/i;

export type SteamIdentifierType =
  | 'STEAM_ID_64'
  | 'STEAM_2'
  | 'STEAM_3'
  | 'PROFILE_URL'
  | 'VANITY_URL';

export interface ParsedSteamIdentifier {
  type: SteamIdentifierType;
  steamId64: string;
}

export function isSteamId64(value: string): boolean {
  if (!steamId64Pattern.test(value)) return false;
  const id = BigInt(value);
  return id >= 76561197960265728n && id <= 76561202255233023n;
}

export function assertSteamId64(value: string): void {
  if (!isSteamId64(value)) throw new Error('Invalid SteamID64');
}

export function parseSteamIdentifier(input: string): ParsedSteamIdentifier | null {
  const trimmed = input.trim();

  if (isSteamId64(trimmed)) {
    return { type: 'STEAM_ID_64', steamId64: trimmed };
  }

  const steam2 = trimmed.match(steam2Pattern);
  if (steam2 !== null) {
    const authServer = steam2[2];
    const accountId = steam2[3];
    if (authServer === undefined || accountId === undefined) return null;
    const accountNumber = BigInt(accountId);
    const accountId64 = accountNumber * 2n + BigInt(authServer);
    const steamId64 = String(76561197960265728n + accountId64);
    if (!isSteamId64(steamId64)) return null;
    return { type: 'STEAM_2', steamId64 };
  }

  const steam3 = trimmed.match(steam3Pattern);
  if (steam3 !== null) {
    const accountId = steam3[1];
    if (accountId === undefined) return null;
    const accountNumber = BigInt(accountId);
    const steamId64 = String(76561197960265728n + accountNumber);
    if (!isSteamId64(steamId64)) return null;
    return { type: 'STEAM_3', steamId64 };
  }

  const profiles = trimmed.match(profilesUrlPattern);
  if (profiles !== null && profiles[1] !== undefined && isSteamId64(profiles[1])) {
    return { type: 'PROFILE_URL', steamId64: profiles[1] };
  }

  const vanity = trimmed.match(idUrlPattern);
  if (vanity !== null && vanity[1] !== undefined) {
    return { type: 'VANITY_URL', steamId64: vanity[1] };
  }

  return null;
}

export function formatSteamId64InputHelp(): string {
  return [
    'Supported formats:',
    '• SteamID64, e.g. `76561198012345678`',
    '• Steam2 ID, e.g. `STEAM_0:1:1234567`',
    '• Steam3 ID, e.g. `[U:1:2469135]`',
    '• Profile URL, e.g. `https://steamcommunity.com/profiles/76561198012345678`',
    '• Vanity URL only if a Steam Web API key is configured.',
  ].join('\n');
}
