import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';

const PARTY_CAPACITY = 5;
const INVITE_TTL_MS = 15 * 60 * 1000;

type TransactionClient = Parameters<PrismaClient['$transaction']>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

type PartyWithMembers = {
  id: string;
  guildId: string;
  leaderDiscordUserId: string;
  members: Array<{ discordUserId: string }>;
};

/**
 * Owns party membership only. Queue entry creation remains the QueueService's
 * responsibility; party mutations take the same guild advisory lock and refuse
 * to change a party once any of its members is queued.
 */
export class PartyService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(guildId: string, leaderDiscordUserId: string): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      await lockGuild(transaction, guildId);
      await assertPartiesEnabled(transaction, guildId);
      await assertNotQueued(transaction, guildId, [leaderDiscordUserId]);
      await assertNotInParty(transaction, leaderDiscordUserId);
      const party = await transaction.tenManParty.create({
        data: {
          guildId,
          leaderDiscordUserId,
          members: { create: { discordUserId: leaderDiscordUserId } },
        },
      });
      return party.id;
    });
  }

  /** Creates a recipient-bound invitation that expires in fifteen minutes. */
  public async invite(
    partyId: string,
    actorDiscordUserId: string,
    inviteeDiscordUserId: string,
  ): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      const party = await findParty(transaction, partyId);
      await lockGuild(transaction, party.guildId);
      const lockedParty = await findParty(transaction, partyId);
      await assertPartiesEnabled(transaction, lockedParty.guildId);
      assertLeader(lockedParty, actorDiscordUserId);
      if (inviteeDiscordUserId === actorDiscordUserId)
        throw new PublicError('PARTY_INVALID_MEMBER', 'You are already in this party.');
      if (lockedParty.members.length >= PARTY_CAPACITY)
        throw new PublicError('PARTY_FULL', 'A party may have at most five members.');
      await assertPartyNotQueued(transaction, lockedParty);
      await assertNotQueued(transaction, lockedParty.guildId, [inviteeDiscordUserId]);
      await assertNotInParty(transaction, inviteeDiscordUserId);

      const now = new Date();
      const pending = await transaction.tenManPartyInvite.findFirst({
        where: {
          partyId,
          inviteeDiscordUserId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (pending !== null)
        throw new PublicError(
          'PARTY_INVITE_PENDING',
          'That player already has a pending invitation.',
        );
      const invitation = await transaction.tenManPartyInvite.create({
        data: {
          partyId,
          inviteeDiscordUserId,
          inviterDiscordUserId: actorDiscordUserId,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        },
      });
      return invitation.id;
    });
  }

  /** Accepts an invitation exactly once after revalidating all mutable state. */
  public async accept(inviteId: string, actorDiscordUserId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.tenManPartyInvite.findUnique({
        where: { id: inviteId },
        include: { party: { include: { members: true } } },
      });
      if (invitation === null || invitation.inviteeDiscordUserId !== actorDiscordUserId)
        throw new PublicError('PARTY_INVITE_NOT_FOUND', 'That party invitation is unavailable.');
      await lockGuild(transaction, invitation.party.guildId);
      const lockedInvitation = await transaction.tenManPartyInvite.findUnique({
        where: { id: inviteId },
        include: { party: { include: { members: true } } },
      });
      if (lockedInvitation === null || lockedInvitation.inviteeDiscordUserId !== actorDiscordUserId)
        throw new PublicError('PARTY_INVITE_NOT_FOUND', 'That party invitation is unavailable.');
      const now = new Date();
      if (
        lockedInvitation.acceptedAt !== null ||
        lockedInvitation.revokedAt !== null ||
        lockedInvitation.expiresAt <= now
      ) {
        throw new PublicError('PARTY_INVITE_EXPIRED', 'That party invitation has expired.');
      }
      await assertPartiesEnabled(transaction, lockedInvitation.party.guildId);
      if (lockedInvitation.party.members.length >= PARTY_CAPACITY)
        throw new PublicError('PARTY_FULL', 'A party may have at most five members.');
      await assertPartyNotQueued(transaction, lockedInvitation.party);
      await assertNotQueued(transaction, lockedInvitation.party.guildId, [actorDiscordUserId]);
      await assertNotInParty(transaction, actorDiscordUserId);

      try {
        await transaction.tenManPartyMember.create({
          data: { partyId: lockedInvitation.partyId, discordUserId: actorDiscordUserId },
        });
      } catch (error) {
        if (isUniqueConstraint(error))
          throw new PublicError('ALREADY_IN_PARTY', 'You are already in a party.');
        throw error;
      }
      await transaction.tenManPartyInvite.update({
        where: { id: inviteId },
        data: { acceptedAt: now },
      });
    });
  }

  public async leave(partyId: string, actorDiscordUserId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const party = await findParty(transaction, partyId);
      await lockGuild(transaction, party.guildId);
      const lockedParty = await findParty(transaction, partyId);
      if (lockedParty.leaderDiscordUserId === actorDiscordUserId) {
        throw new PublicError(
          'PARTY_LEADER_CANNOT_LEAVE',
          'The party leader must disband the party.',
        );
      }
      assertMember(lockedParty, actorDiscordUserId);
      await assertPartyNotQueued(transaction, lockedParty);
      await transaction.tenManPartyMember.delete({
        where: { partyId_discordUserId: { partyId, discordUserId: actorDiscordUserId } },
      });
    });
  }

  public async kick(
    partyId: string,
    actorDiscordUserId: string,
    targetDiscordUserId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const party = await findParty(transaction, partyId);
      await lockGuild(transaction, party.guildId);
      const lockedParty = await findParty(transaction, partyId);
      assertLeader(lockedParty, actorDiscordUserId);
      if (targetDiscordUserId === actorDiscordUserId)
        throw new PublicError('PARTY_INVALID_MEMBER', 'The leader cannot kick themselves.');
      assertMember(lockedParty, targetDiscordUserId);
      await assertPartyNotQueued(transaction, lockedParty);
      await transaction.tenManPartyMember.delete({
        where: { partyId_discordUserId: { partyId, discordUserId: targetDiscordUserId } },
      });
    });
  }

  public async disband(partyId: string, actorDiscordUserId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const party = await findParty(transaction, partyId);
      await lockGuild(transaction, party.guildId);
      const lockedParty = await findParty(transaction, partyId);
      assertLeader(lockedParty, actorDiscordUserId);
      await assertPartyNotQueued(transaction, lockedParty);
      await transaction.tenManParty.delete({ where: { id: partyId } });
    });
  }

  /** Read model for the party panel: current party plus pending invitations. */
  public async getPanelState(
    guildId: string,
    discordUserId: string,
  ): Promise<{
    enabled: boolean;
    party: {
      id: string;
      leaderDiscordUserId: string;
      members: Array<{ discordUserId: string }>;
    } | null;
    pendingInvites: Array<{
      id: string;
      partyId: string;
      inviterDiscordUserId: string;
      expiresAt: Date;
    }>;
  }> {
    const [settings, membership, invites] = await Promise.all([
      this.prisma.tenManSettings.findUnique({
        where: { guildId },
        select: { partyEnabled: true },
      }),
      this.prisma.tenManPartyMember.findUnique({
        where: { discordUserId },
        include: {
          party: { include: { members: { select: { discordUserId: true } } } },
        },
      }),
      this.prisma.tenManPartyInvite.findMany({
        where: {
          inviteeDiscordUserId: discordUserId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          party: { guildId },
        },
        select: { id: true, partyId: true, inviterDiscordUserId: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const party =
      membership === null || membership.party.guildId !== guildId ? null : membership.party;
    return {
      enabled: settings?.partyEnabled ?? false,
      party:
        party === null
          ? null
          : {
              id: party.id,
              leaderDiscordUserId: party.leaderDiscordUserId,
              members: party.members,
            },
      pendingInvites: invites,
    };
  }
}

async function lockGuild(transaction: TransactionClient, guildId: string): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
}

async function assertPartiesEnabled(
  transaction: TransactionClient,
  guildId: string,
): Promise<void> {
  const settings = await transaction.tenManSettings.findUnique({ where: { guildId } });
  if (settings === null || !settings.partyEnabled)
    throw new PublicError('PARTIES_DISABLED', 'Parties are disabled.');
}

async function findParty(
  transaction: TransactionClient,
  partyId: string,
): Promise<PartyWithMembers> {
  const party = await transaction.tenManParty.findUnique({
    where: { id: partyId },
    include: { members: { select: { discordUserId: true } } },
  });
  if (party === null) throw new PublicError('PARTY_NOT_FOUND', 'That party no longer exists.');
  return party;
}

function assertLeader(party: PartyWithMembers, actorDiscordUserId: string): void {
  if (party.leaderDiscordUserId !== actorDiscordUserId)
    throw new PublicError('PARTY_FORBIDDEN', 'Only the party leader can do that.');
}

function assertMember(party: PartyWithMembers, discordUserId: string): void {
  if (!party.members.some((member) => member.discordUserId === discordUserId))
    throw new PublicError('PARTY_NOT_MEMBER', 'You are not in this party.');
}

async function assertNotInParty(
  transaction: TransactionClient,
  discordUserId: string,
): Promise<void> {
  const membership = await transaction.tenManPartyMember.findUnique({
    where: { discordUserId },
  });
  if (membership !== null) throw new PublicError('ALREADY_IN_PARTY', 'You are already in a party.');
}

async function assertPartyNotQueued(
  transaction: TransactionClient,
  party: PartyWithMembers,
): Promise<void> {
  await assertNotQueued(
    transaction,
    party.guildId,
    party.members.map((member) => member.discordUserId),
  );
}

async function assertNotQueued(
  transaction: TransactionClient,
  guildId: string,
  discordUserIds: string[],
): Promise<void> {
  const queued = await transaction.tenManQueueEntry.findFirst({
    where: { guildId, discordUserId: { in: discordUserIds } },
    select: { id: true },
  });
  if (queued !== null)
    throw new PublicError(
      'PARTY_QUEUED',
      'Party membership cannot change while a member is queued.',
    );
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
