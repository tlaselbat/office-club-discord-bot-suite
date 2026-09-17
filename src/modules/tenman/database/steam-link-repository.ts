import type { PrismaClient } from '../../../generated/prisma/client.js';
import type {
  SteamIdentityRecord,
  SteamLinkRepository,
  SteamLinkSessionRecord,
} from '../services/steam-link-service.js';

export class PrismaSteamLinkRepository implements SteamLinkRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createSession(session: SteamLinkSessionRecord): Promise<void> {
    await this.prisma.steamLinkSession.create({ data: session });
  }

  public async findUsableSession(
    tokenHash: string,
    now: Date,
  ): Promise<SteamLinkSessionRecord | null> {
    return this.prisma.steamLinkSession.findFirst({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
      select: {
        tokenHash: true,
        discordUserId: true,
        expectedReturnUrl: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
  }

  public async consumeAndLink(
    tokenHash: string,
    identity: SteamIdentityRecord,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.steamLinkSession.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new Error('Steam link session is invalid or expired');
      const protectedParticipation = await transaction.matchPlayer.findFirst({
        where: {
          discordUserId: identity.discordUserId,
          match: {
            state: {
              in: [
                'TEAMS_LOCKED',
                'SERVER_PROVISIONING',
                'SERVER_BOOTING',
                'SERVER_READY',
                'MATCH_LOADED',
                'WARMUP',
                'LIVE',
                'PAUSED',
              ],
            },
          },
        },
        select: { id: true },
      });
      if (protectedParticipation !== null)
        throw new Error('Steam identity is locked by an active match');
      await transaction.steamIdentity.updateMany({
        where: { discordUserId: identity.discordUserId, invalidatedAt: null },
        data: { invalidatedAt: now, invalidationReason: 'SELF_RELINK' },
      });
      await transaction.steamIdentity.create({
        data: { ...identity, provenance: 'STEAM_OPENID' },
      });
    });
  }
}
