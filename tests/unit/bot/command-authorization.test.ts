import { describe, expect, it } from 'vitest';
import { commands } from '../../../src/modules/tenman/bot/commands.js';
import {
  isAuthorized,
  type ActorContext,
  type MatchAction,
} from '../../../src/modules/tenman/domain/authorization.js';

// Mirrors the assertAuthorized() calls in src/bot/client.ts for each
// registered staff subcommand. If dispatch gains a new privileged branch,
// extend this map so the matrix stays honest.
const adminSubcommandActions: Record<string, MatchAction> = {
  match: 'VIEW_ADMIN',
  queue: 'QUEUE_BAN',
  players: 'RESET_PLAYER_STATS',
  disputes: 'RESOLVE_DISPUTE',
  diagnostics: 'DIAGNOSTICS',
  'queue-panel': 'VIEW_ADMIN',
};

const configSubcommandActions: Record<string, MatchAction> = {
  status: 'CONFIGURE_GUILD',
  setup: 'SETUP_GUILD',
  configure: 'CONFIGURE_GUILD',
  enable: 'ENABLE_GUILD',
  disable: 'DISABLE_GUILD',
  teardown: 'TEARDOWN_GUILD',
  'recover-setup': 'RECOVER_GUILD_SETUP',
};

const ordinaryPlayer: ActorContext = {
  discordUserId: 'player',
  isParticipant: true,
  isPrivilegedMember: true,
  isModerator: false,
  isAdministrator: false,
};

const moderator: ActorContext = { ...ordinaryPlayer, isModerator: true };
const configuredAdmin: ActorContext = { ...ordinaryPlayer, isAdministrator: true };

describe('staff command authorization matrix', () => {
  it('denies ordinary players every /10man-admin subcommand action', () => {
    for (const action of Object.values(adminSubcommandActions)) {
      expect(isAuthorized(action, ordinaryPlayer)).toBe(false);
    }
  });

  it('denies ordinary players every /10man-config subcommand action', () => {
    for (const action of Object.values(configSubcommandActions)) {
      expect(isAuthorized(action, ordinaryPlayer)).toBe(false);
    }
  });

  it('allows configured moderators the moderation panels', () => {
    for (const action of Object.values(adminSubcommandActions)) {
      expect(isAuthorized(action, moderator)).toBe(true);
    }
  });

  it('denies configured moderators every /10man-config operation', () => {
    for (const action of Object.values(configSubcommandActions)) {
      expect(isAuthorized(action, moderator)).toBe(false);
    }
  });

  it('allows configured administrators every staff action', () => {
    for (const action of [
      ...Object.values(adminSubcommandActions),
      ...Object.values(configSubcommandActions),
    ]) {
      expect(isAuthorized(action, configuredAdmin)).toBe(true);
    }
  });

  it('grants native Discord Administrator the administrator flag', () => {
    // createGuildAdminActor folds native Administrator into isAdministrator;
    // the same context therefore authorizes every staff action.
    const nativeAdmin: ActorContext = {
      discordUserId: 'admin',
      isParticipant: false,
      isPrivilegedMember: false,
      isModerator: true,
      isAdministrator: true,
    };
    for (const action of [
      ...Object.values(adminSubcommandActions),
      ...Object.values(configSubcommandActions),
    ]) {
      expect(isAuthorized(action, nativeAdmin)).toBe(true);
    }
  });
});

describe('command-level Discord permission defaults', () => {
  it('does not set default_member_permissions on any 10man command', () => {
    // Configured moderator/administrator role IDs live in TenManSettings and
    // Discord cannot express them at registration time; relying on
    // default_member_permissions would hide staff commands from the very
    // roles the backend authorizes.
    for (const command of commands) {
      expect(
        (command as { default_member_permissions?: string }).default_member_permissions ?? null,
      ).toBeNull();
    }
  });
});
