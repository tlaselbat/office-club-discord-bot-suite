import { z } from 'zod';

const tokenSchema = z.object({ access_token: z.string().min(1), token_type: z.string().min(1) });
const identitySchema = z.object({ id: z.string().regex(/^\d{17,20}$/), username: z.string() });

export interface DiscordIdentity {
  id: string;
  username: string;
}

export class DiscordOAuthClient {
  public constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  public authorizationUrl(state: string): string {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'identify',
      state,
    }).toString();
    return url.toString();
  }

  public async identify(code: string): Promise<DiscordIdentity> {
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error('Discord OAuth token exchange failed');
    const token = tokenSchema.parse(await tokenResponse.json());
    const identityResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `${token.token_type} ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!identityResponse.ok) throw new Error('Discord identity lookup failed');
    return identitySchema.parse(await identityResponse.json());
  }
}
