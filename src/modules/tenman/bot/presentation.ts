/** Centralized player-facing labels for internal lifecycle states. */
export function matchPhaseLabel(state: string): string {
  switch (state) {
    case 'READY_CHECK':
      return 'Ready check';
    case 'TEAM_SELECTION':
      return 'Choosing teams';
    case 'MAP_VETO':
      return 'Choosing the map';
    case 'TEAMS_LOCKED':
      return 'Teams locked';
    case 'SERVER_PROVISIONING':
      return 'Preparing server';
    case 'SERVER_BOOTING':
      return 'Starting server';
    case 'SERVER_READY':
      return 'Server ready';
    case 'MATCH_LOADED':
      return 'Match ready';
    case 'WARMUP':
      return 'Warmup';
    case 'LIVE':
      return 'Match live';
    case 'PAUSED':
      return 'Match paused';
    case 'FINISHED':
      return 'Match complete';
    case 'CANCELED':
      return 'Match canceled';
    case 'FAILED':
      return "Match couldn't be started";
    default:
      return state.replaceAll('_', ' ').toLowerCase();
  }
}

export function playersNeededLabel(playersNeeded: number): string {
  if (playersNeeded === 0) return 'Queue full';
  return `${String(playersNeeded)} more player${playersNeeded === 1 ? '' : 's'}`;
}
