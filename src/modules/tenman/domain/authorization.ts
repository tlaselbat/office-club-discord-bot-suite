import type { MatchState } from './match-state.js';

export const matchActions = [
  'VIEW',
  'JOIN',
  'LEAVE',
  'READY',
  'CREATE',
  'ORGANIZE_TEAMS',
  'SELECT_MAP',
  'SELECT_PROFILE',
  'LOCK_TEAMS',
  'START_SERVER',
  'START_MATCH',
  'PAUSE',
  'RESUME',
  'RESTORE',
  'STOP',
  'TRANSFER_LEADER',
  'REMOVE_PARTICIPANT',
  'CONFIGURE_GUILD',
  'SETUP_GUILD',
  'RECOVER_GUILD_SETUP',
  'DISABLE_GUILD',
  'ENABLE_GUILD',
  'TEARDOWN_GUILD',
  'DIAGNOSTICS',
  'JOIN_QUEUE',
  'LEAVE_QUEUE',
  'MANAGE_QUEUE',
  'WITHDRAW_READY',
  'CAPTAIN_VOLUNTEER',
  'CAPTAIN_PICK',
  'VETO_MAP',
  'FORCE_READY',
  'REPLACE_PARTICIPANT',
  'RESTART_PHASE',
  'OVERRIDE_CAPTAIN',
  'OVERRIDE_TEAM',
  'OVERRIDE_MAP',
  'VIEW_ADMIN',
  'ROLLBACK_MATCH',
  'RESET_PLAYER_STATS',
  'QUEUE_BAN',
  'QUEUE_UNBAN',
] as const;

export type MatchAction = (typeof matchActions)[number];

export interface ActorContext {
  discordUserId: string;
  isParticipant: boolean;
  isPrivilegedMember: boolean;
  isModerator: boolean;
  isAdministrator: boolean;
}

export interface MatchAuthorizationContext {
  leaderDiscordUserId: string;
  state: MatchState;
}

const leaderActions = new Set<MatchAction>([
  'ORGANIZE_TEAMS',
  'SELECT_MAP',
  'SELECT_PROFILE',
  'LOCK_TEAMS',
  'START_SERVER',
  'START_MATCH',
  'PAUSE',
  'RESUME',
  'RESTORE',
  'STOP',
  'CAPTAIN_PICK',
  'VETO_MAP',
]);

const moderatorActions = new Set<MatchAction>([
  ...leaderActions,
  'TRANSFER_LEADER',
  'REMOVE_PARTICIPANT',
  'DIAGNOSTICS',
  'MANAGE_QUEUE',
  'FORCE_READY',
  'REPLACE_PARTICIPANT',
  'RESTART_PHASE',
  'OVERRIDE_CAPTAIN',
  'OVERRIDE_TEAM',
  'OVERRIDE_MAP',
  'VIEW_ADMIN',
  'ROLLBACK_MATCH',
  'RESET_PLAYER_STATS',
  'QUEUE_BAN',
  'QUEUE_UNBAN',
]);

export function isAuthorized(
  action: MatchAction,
  actor: ActorContext,
  match?: MatchAuthorizationContext,
): boolean {
  if (actor.isAdministrator) return true;
  if (
    [
      'CONFIGURE_GUILD',
      'SETUP_GUILD',
      'RECOVER_GUILD_SETUP',
      'DISABLE_GUILD',
      'ENABLE_GUILD',
      'TEARDOWN_GUILD',
    ].includes(action)
  )
    return false;
  if (actor.isModerator && moderatorActions.has(action)) return true;
  if (action === 'CREATE') return actor.isPrivilegedMember;
  if (action === 'VIEW') return actor.isParticipant || actor.isPrivilegedMember;
  if (action === 'JOIN' || action === 'JOIN_QUEUE') return !actor.isParticipant;
  if (
    action === 'LEAVE' ||
    action === 'READY' ||
    action === 'WITHDRAW_READY' ||
    action === 'LEAVE_QUEUE'
  )
    return actor.isParticipant;
  return (
    match !== undefined &&
    match.leaderDiscordUserId === actor.discordUserId &&
    leaderActions.has(action)
  );
}

export function assertAuthorized(
  action: MatchAction,
  actor: ActorContext,
  match?: MatchAuthorizationContext,
): void {
  if (!isAuthorized(action, actor, match)) throw new Error(`Not authorized for ${action}`);
}
