import type { MatchState } from './match-state.js';

export const matchActions = [
  'ORGANIZE_TEAMS',
  'STOP',
  'CONFIGURE_GUILD',
  'SETUP_GUILD',
  'RECOVER_GUILD_SETUP',
  'DISABLE_GUILD',
  'ENABLE_GUILD',
  'TEARDOWN_GUILD',
  'DIAGNOSTICS',
  'FORCE_READY',
  'REPLACE_PARTICIPANT',
  'RESTART_PHASE',
  'VIEW_ADMIN',
  'ROLLBACK_MATCH',
  'RESET_PLAYER_STATS',
  'QUEUE_BAN',
  'QUEUE_UNBAN',
  'RESOLVE_DISPUTE',
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

const leaderActions = new Set<MatchAction>(['ORGANIZE_TEAMS', 'STOP']);

const moderatorActions = new Set<MatchAction>([
  ...leaderActions,
  'DIAGNOSTICS',
  'FORCE_READY',
  'REPLACE_PARTICIPANT',
  'RESTART_PHASE',
  'VIEW_ADMIN',
  'ROLLBACK_MATCH',
  'RESET_PLAYER_STATS',
  'QUEUE_BAN',
  'QUEUE_UNBAN',
  'RESOLVE_DISPUTE',
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
