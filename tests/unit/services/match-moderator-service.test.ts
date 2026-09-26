import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { MatchModeratorService } from '../../../src/modules/tenman/services/match-moderator-service.js';

function fakePrisma(
  membership: { status: 'ACTIVE' | 'SUSPENDED_STEAM_INVALID' } | null,
  hasSteamIdentity: boolean,
) {
  const updates: Array<{ data: { status: string } }> = [];
  return {
    matchModerator: {
      findUnique: async () => membership,
      update: async (value: { data: { status: string } }) => {
        updates.push(value);
      },
    },
    steamIdentity: {
      findFirst: async () => (hasSteamIdentity ? { id: 'identity' } : null),
    },
    updates,
  } as unknown as PrismaClient & { updates: Array<{ data: { status: string } }> };
}

describe('MatchModeratorService', () => {
  it('grants operational moderation only to an active membership with a current Steam identity', async () => {
    const prisma = fakePrisma({ status: 'ACTIVE' }, true);
    const service = new MatchModeratorService(prisma);

    const actor = await service.resolveActor('guild', {
      discordUserId: 'moderator',
      isParticipant: false,
      isPrivilegedMember: false,
      isAdministrator: false,
    });

    expect(actor.isModerator).toBe(true);
    expect(prisma.updates).toEqual([]);
  });

  it('suspends a moderator whose Steam identity is no longer active', async () => {
    const prisma = fakePrisma({ status: 'ACTIVE' }, false);
    const service = new MatchModeratorService(prisma);

    expect(await service.hasActiveMembership('guild', 'moderator')).toBe(false);
    expect(prisma.updates).toHaveLength(1);
    expect(prisma.updates[0]?.data.status).toBe('SUSPENDED_STEAM_INVALID');
  });

  it('reactivates a suspended moderator after a valid replacement Steam identity exists', async () => {
    const prisma = fakePrisma({ status: 'SUSPENDED_STEAM_INVALID' }, true);
    const service = new MatchModeratorService(prisma);

    expect(await service.hasActiveMembership('guild', 'moderator')).toBe(true);
    expect(prisma.updates).toHaveLength(1);
    expect(prisma.updates[0]?.data.status).toBe('ACTIVE');
  });
});
