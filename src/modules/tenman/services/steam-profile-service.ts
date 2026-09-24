export interface SteamProfileSummary {
  steamId64: string;
  displayName: string;
  profileUrl?: string | undefined;
}

export interface SteamProfileService {
  resolveVanityUrl(vanityName: string): Promise<string | null>;
  getPlayerSummary(steamId64: string): Promise<SteamProfileSummary | null>;
}

export class OptionalSteamProfileService implements SteamProfileService {
  public constructor(private readonly apiKey: string | undefined) {}

  public async resolveVanityUrl(vanityName: string): Promise<string | null> {
    if (this.apiKey === undefined) return null;
    try {
      const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/');
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('vanityurl', vanityName);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        response?: { success?: number; steamid?: string; message?: string };
      };
      const steamId64 = data.response?.steamid;
      if (data.response?.success !== 1 || steamId64 === undefined) return null;
      return steamId64;
    } catch {
      return null;
    }
  }

  public async getPlayerSummary(steamId64: string): Promise<SteamProfileSummary | null> {
    if (this.apiKey === undefined) return null;
    try {
      const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('steamids', steamId64);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        response?: {
          players?: Array<{ steamid: string; personaname: string; profileurl?: string }>;
        };
      };
      const player = data.response?.players?.[0];
      if (player === undefined) return null;
      return {
        steamId64: player.steamid,
        displayName: player.personaname,
        profileUrl: player.profileurl,
      };
    } catch {
      return null;
    }
  }
}

export function createSteamProfileService(apiKey?: string): SteamProfileService {
  return new OptionalSteamProfileService(apiKey);
}
