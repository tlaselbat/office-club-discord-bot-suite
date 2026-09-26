import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ActorContext } from '../domain/authorization.js';

export interface AddMatchModeratorCommand {
  guildId: string;
  discordUserId: string;
  addedByDiscordUserId: string;
  correlationId: string;
}

export interface RemoveMatchModeratorCommand {
  guildId: string;
  discordUserId: string;
  actorDiscordUserId: string;
  correlationId: string;
}

/**
 * Owns individual Match Moderator membership. A role alone never grants this
 * authority: each operational authorization also requires a current Steam
 * assignment.
 */
export class MatchModeratorService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async add(command: AddMatchModeratorCommand): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const identity = await transaction.steamIdentity.findFirst({
        where: { discordUserId: command.discordUserId, invalidatedAt: null },
        select: { steamId64: true },
      });
      if (identity === null) throw new Error('Match Moderators must have an active Steam account');

      await transaction.matchModerator.upsert({
        where: {
          guildId_discordUserId: {
            guildId: command.guildId,
            discordUserId: command.discordUserId,
          },
        },
        create: {
          guildId: command.guildId,
          discordUserId: command.discordUserId,
          addedByDiscordUserId: command.addedByDiscordUserId,
        },
        update: { status: 'ACTIVE', addedByDiscordUserId: command.addedByDiscordUserId },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.addedByDiscordUserId,
          eventType: 'match_moderator_added',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { discordUserId: command.discordUserId, steamId64: identity.steamId64 },
        },
      });
    });
  }

  public async remove(command: RemoveMatchModeratorCommand): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.matchModerator.deleteMany({
        where: { guildId: command.guildId, discordUserId: command.discordUserId },
      });
      await transaction.auditEvent.create({
        data: {
          guildId: command.guildId,
          actorDiscordUserId: command.actorDiscordUserId,
          eventType: 'match_moderator_removed',
          result: 'success',
          correlationId: command.correlationId,
          metadata: { discordUserId: command.discordUserId },
        },
      });
    });
  }

  public async list(guildId: string) {
    return this.prisma.matchModerator.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
      select: { discordUserId: true, status: true, addedByDiscordUserId: true, createdAt: true },
    });
  }

  public async hasActiveMembership(guildId: string, discordUserId: string): Promise<boolean> {
    const [membership, identity] = await Promise.all([
      this.prisma.matchModerator.findUnique({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        select: { status: true },
      }),
      this.prisma.steamIdentity.findFirst({
        where: { discordUserId, invalidatedAt: null },
        select: { id: true },
      }),
    ]);
    if (membership === null) return false;

    const shouldBeActive = identity !== null;
    const expectedStatus = shouldBeActive ? 'ACTIVE' : 'SUSPENDED_STEAM_INVALID';
    if (membership.status !== expectedStatus) {
      await this.prisma.matchModerator.update({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        data: { status: expectedStatus },
      });
    }
    return shouldBeActive;
  }

  /** Resolves the operational flag without treating moderator Discord roles as authority. */
  public async resolveActor(
    guildId: string,
    actor: Omit<ActorContext, 'isModerator'>,
  ): Promise<ActorContext> {
    return {
      ...actor,
      isModerator: await this.hasActiveMembership(guildId, actor.discordUserId),
    };
  }
}
