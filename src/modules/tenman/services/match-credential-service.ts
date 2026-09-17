import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CredentialCapability, PrismaClient } from '../../../generated/prisma/client.js';

export interface IssuedCredential {
  token: string;
  expiresAt: Date;
  version: number;
}

export class MatchCredentialService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async issue(
    matchId: string,
    capability: CredentialCapability,
    serverId: string | null,
    lifetimeMs: number,
    now = new Date(),
  ): Promise<IssuedCredential> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + lifetimeMs);
    const result = await this.prisma.$transaction(async (transaction) => {
      const latest = await transaction.matchCredential.findFirst({
        where: { matchId, capability },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      await transaction.matchCredential.updateMany({
        where: { matchId, capability, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.matchCredential.create({
        data: {
          matchId,
          capability,
          tokenHash: hash(token),
          serverId,
          version,
          expiresAt,
        },
      });
      return version;
    });
    return { token, expiresAt, version: result };
  }

  public async verify(
    token: string,
    matchId: string,
    capability: CredentialCapability,
    serverId: string | null,
    now = new Date(),
  ): Promise<boolean> {
    const tokenHash = hash(token);
    const credential = await this.prisma.matchCredential.findUnique({ where: { tokenHash } });
    if (credential === null) return false;
    const hashesMatch = timingSafeEqual(Buffer.from(credential.tokenHash), Buffer.from(tokenHash));
    return (
      hashesMatch &&
      credential.matchId === matchId &&
      credential.capability === capability &&
      credential.revokedAt === null &&
      credential.expiresAt > now &&
      credential.serverId === serverId
    );
  }

  public async revokeMatch(matchId: string, now = new Date()): Promise<void> {
    await this.prisma.matchCredential.updateMany({
      where: { matchId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
