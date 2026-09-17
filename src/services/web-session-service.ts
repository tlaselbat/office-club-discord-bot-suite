import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export interface WebSessionIdentity {
  discordUserId: string;
  expiresAt: Date;
}

export class WebSessionService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(discordUserId: string, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.webSession.create({
      data: {
        tokenHash: this.hash(token),
        discordUserId,
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
        lastSeenAt: now,
      },
    });
    return token;
  }

  public async resolve(token: string, now = new Date()): Promise<WebSessionIdentity | null> {
    const session = await this.prisma.webSession.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (session === null || session.expiresAt <= now) return null;
    if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.prisma.webSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    }
    return { discordUserId: session.discordUserId, expiresAt: session.expiresAt };
  }

  public async revoke(token: string): Promise<void> {
    await this.prisma.webSession.deleteMany({ where: { tokenHash: this.hash(token) } });
  }

  public async deleteExpired(now = new Date()): Promise<number> {
    const result = await this.prisma.webSession.deleteMany({ where: { expiresAt: { lte: now } } });
    return result.count;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
