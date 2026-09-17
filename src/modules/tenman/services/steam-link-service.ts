import { createHash, randomBytes } from 'node:crypto';

export interface SteamLinkSessionRecord {
  tokenHash: string;
  discordUserId: string;
  expectedReturnUrl: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface SteamIdentityRecord {
  discordUserId: string;
  steamId64: string;
  verifiedAt: Date;
}

export interface SteamLinkRepository {
  createSession(session: SteamLinkSessionRecord): Promise<void>;
  findUsableSession(tokenHash: string, now: Date): Promise<SteamLinkSessionRecord | null>;
  consumeAndLink(tokenHash: string, identity: SteamIdentityRecord, now: Date): Promise<void>;
}

export interface SteamLinkChallenge {
  token: string;
  expiresAt: Date;
  startUrl: URL;
}

export class SteamLinkService {
  public constructor(
    private readonly repository: SteamLinkRepository,
    private readonly publicBaseUrl: URL,
    private readonly sessionLifetimeMs = 10 * 60 * 1000,
  ) {}

  public async createChallenge(
    discordUserId: string,
    now = new Date(),
  ): Promise<SteamLinkChallenge> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(now.getTime() + this.sessionLifetimeMs);
    const expectedReturnUrl = new URL('/auth/steam/callback', this.publicBaseUrl);
    expectedReturnUrl.searchParams.set('session', token);
    await this.repository.createSession({
      tokenHash,
      discordUserId,
      expectedReturnUrl: expectedReturnUrl.toString(),
      expiresAt,
      consumedAt: null,
    });
    return {
      token,
      expiresAt,
      startUrl: new URL(`/auth/steam/start/${encodeURIComponent(token)}`, this.publicBaseUrl),
    };
  }

  public async getSession(token: string, now = new Date()): Promise<SteamLinkSessionRecord> {
    const session = await this.repository.findUsableSession(hashToken(token), now);
    if (session === null) throw new Error('Steam link session is invalid or expired');
    return session;
  }

  public async complete(token: string, steamId64: string, now = new Date()): Promise<void> {
    const session = await this.getSession(token, now);
    await this.repository.consumeAndLink(
      session.tokenHash,
      { discordUserId: session.discordUserId, steamId64, verifiedAt: now },
      now,
    );
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
