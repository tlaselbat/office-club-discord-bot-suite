import { describe, expect, it } from 'vitest';
import {
  SteamLinkService,
  type SteamIdentityRecord,
  type SteamLinkRepository,
  type SteamLinkSessionRecord,
} from '../../src/modules/tenman/services/steam-link-service.js';

class MemoryRepository implements SteamLinkRepository {
  public sessions = new Map<string, SteamLinkSessionRecord>();
  public identities: SteamIdentityRecord[] = [];

  public createSession(session: SteamLinkSessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, session);
    return Promise.resolve();
  }

  public findUsableSession(tokenHash: string, now: Date): Promise<SteamLinkSessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    return Promise.resolve(
      session !== undefined && session.consumedAt === null && session.expiresAt > now
        ? session
        : null,
    );
  }

  public consumeAndLink(
    tokenHash: string,
    identity: SteamIdentityRecord,
    now: Date,
  ): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session === undefined || session.consumedAt !== null)
      return Promise.reject(new Error('used'));
    session.consumedAt = now;
    this.identities.push(identity);
    return Promise.resolve();
  }
}

describe('SteamLinkService', () => {
  it('creates a hashed, expiring challenge and consumes it once', async () => {
    const repository = new MemoryRepository();
    const service = new SteamLinkService(repository, new URL('https://bot.example.com'));
    const challenge = await service.createChallenge('123', new Date('2026-01-01T00:00:00Z'));
    expect(challenge.startUrl.toString()).not.toContain(
      [...repository.sessions.keys()][0] ?? 'none',
    );
    await service.complete(challenge.token, '76561197960265728', new Date('2026-01-01T00:01:00Z'));
    expect(repository.identities).toHaveLength(1);
    await expect(service.complete(challenge.token, '76561197960265728')).rejects.toThrow();
  });

  it('rejects an expired challenge', async () => {
    const service = new SteamLinkService(
      new MemoryRepository(),
      new URL('https://bot.example.com'),
      1,
    );
    const challenge = await service.createChallenge('123', new Date(0));
    await expect(service.getSession(challenge.token, new Date(2))).rejects.toThrow(
      'invalid or expired',
    );
  });
});
