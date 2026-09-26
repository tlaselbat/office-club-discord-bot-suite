import { describe, expect, it } from 'vitest';
import { isAuthorized, type ActorContext } from '../../src/modules/tenman/domain/authorization.js';

const participant: ActorContext = {
  discordUserId: 'player',
  isParticipant: true,
  isPrivilegedMember: false,
  isModerator: false,
  isAdministrator: false,
};

const match = { leaderDiscordUserId: 'leader', state: 'TEAM_SELECTION' as const };

describe('authorization policy', () => {
  it('scopes leader authority to the matching leader identity', () => {
    expect(isAuthorized('ORGANIZE_TEAMS', { ...participant, discordUserId: 'leader' }, match)).toBe(
      true,
    );
    expect(isAuthorized('ORGANIZE_TEAMS', participant, match)).toBe(false);
  });

  it('allows moderators to control any match but not configure the guild', () => {
    const moderator = { ...participant, isModerator: true };
    expect(isAuthorized('STOP', moderator, match)).toBe(true);
    expect(isAuthorized('CONFIGURE_GUILD', moderator, match)).toBe(false);
    expect(isAuthorized('QUEUE_BAN', moderator, match)).toBe(true);
    expect(isAuthorized('ROLLBACK_MATCH', moderator, match)).toBe(true);
    expect(isAuthorized('RESOLVE_DISPUTE', moderator)).toBe(true);
    expect(isAuthorized('OPERATE_QUEUE', moderator)).toBe(true);
    expect(isAuthorized('REPAIR_QUEUE_PANEL', moderator)).toBe(true);
    expect(isAuthorized('MANAGE_MATCH_MODERATORS', moderator)).toBe(false);
  });

  it('denies non-moderators moderation actions', () => {
    expect(isAuthorized('RESOLVE_DISPUTE', participant)).toBe(false);
    expect(isAuthorized('QUEUE_BAN', participant, match)).toBe(false);
  });

  it('allows administrators to perform every action', () => {
    expect(isAuthorized('CONFIGURE_GUILD', { ...participant, isAdministrator: true }, match)).toBe(
      true,
    );
  });
});
