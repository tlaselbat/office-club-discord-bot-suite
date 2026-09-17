import { describe, expect, it } from 'vitest';
import { isAuthorized, type ActorContext } from '../../src/modules/tenman/domain/authorization.js';

const participant: ActorContext = {
  discordUserId: 'player',
  isParticipant: true,
  isPrivilegedMember: false,
  isModerator: false,
  isAdministrator: false,
};

const match = { leaderDiscordUserId: 'leader', state: 'TEAM_SETUP' as const };

describe('authorization policy', () => {
  it('scopes leader authority to the matching leader identity', () => {
    expect(isAuthorized('ORGANIZE_TEAMS', { ...participant, discordUserId: 'leader' }, match)).toBe(
      true,
    );
    expect(isAuthorized('ORGANIZE_TEAMS', participant, match)).toBe(false);
  });

  it('allows configured privilege to create without granting controls', () => {
    const privileged = { ...participant, isParticipant: false, isPrivilegedMember: true };
    expect(isAuthorized('CREATE', privileged)).toBe(true);
    expect(isAuthorized('PAUSE', privileged, match)).toBe(false);
  });

  it('allows moderators to control any match but not configure the guild', () => {
    const moderator = { ...participant, isModerator: true };
    expect(isAuthorized('STOP', moderator, match)).toBe(true);
    expect(isAuthorized('CONFIGURE_GUILD', moderator, match)).toBe(false);
  });

  it('allows administrators to perform every action', () => {
    expect(isAuthorized('CONFIGURE_GUILD', { ...participant, isAdministrator: true }, match)).toBe(
      true,
    );
  });
});
