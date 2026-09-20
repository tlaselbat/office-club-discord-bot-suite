export const matchStates = [
  'CREATED',
  'READY_CHECK',
  'TEAM_SELECTION',
  'MAP_VETO',
  'TEAMS_LOCKED',
  'SERVER_PROVISIONING',
  'SERVER_BOOTING',
  'SERVER_READY',
  'MATCH_LOADED',
  'WARMUP',
  'LIVE',
  'PAUSED',
  'FINISHED',
  'CANCELED',
  'FAILED',
] as const;

export type MatchState = (typeof matchStates)[number];

export const cleanupStatuses = [
  'NOT_REQUIRED',
  'PENDING',
  'RUNNING',
  'RETRY',
  'COMPLETE',
  'FAILED',
] as const;

export type CleanupStatus = (typeof cleanupStatuses)[number];

const forwardTransitions: Readonly<Record<MatchState, readonly MatchState[]>> = {
  CREATED: ['READY_CHECK'],
  READY_CHECK: ['TEAM_SELECTION'],
  TEAM_SELECTION: ['MAP_VETO', 'TEAMS_LOCKED'],
  MAP_VETO: ['TEAMS_LOCKED'],
  TEAMS_LOCKED: ['SERVER_PROVISIONING'],
  SERVER_PROVISIONING: ['SERVER_BOOTING'],
  SERVER_BOOTING: ['SERVER_READY'],
  SERVER_READY: ['MATCH_LOADED'],
  MATCH_LOADED: ['WARMUP'],
  WARMUP: ['LIVE'],
  LIVE: ['PAUSED', 'FINISHED'],
  PAUSED: ['LIVE', 'FINISHED'],
  FINISHED: [],
  CANCELED: [],
  FAILED: [],
};

const terminalStates = new Set<MatchState>(['FINISHED', 'CANCELED', 'FAILED']);

export function isTerminalMatchState(state: MatchState): boolean {
  return terminalStates.has(state);
}

export function canTransitionMatch(from: MatchState, to: MatchState): boolean {
  if (forwardTransitions[from].includes(to)) return true;
  return !isTerminalMatchState(from) && (to === 'CANCELED' || to === 'FAILED');
}

export function transitionMatch(from: MatchState, to: MatchState): MatchState {
  if (!canTransitionMatch(from, to)) {
    throw new Error(`Illegal match transition: ${from} -> ${to}`);
  }
  return to;
}

const cleanupTransitions: Readonly<Record<CleanupStatus, readonly CleanupStatus[]>> = {
  NOT_REQUIRED: ['PENDING'],
  PENDING: ['RUNNING'],
  RUNNING: ['RETRY', 'COMPLETE', 'FAILED'],
  RETRY: ['RUNNING', 'FAILED'],
  COMPLETE: [],
  FAILED: ['PENDING'],
};

export function canTransitionCleanup(from: CleanupStatus, to: CleanupStatus): boolean {
  return cleanupTransitions[from].includes(to);
}

export function occupiesGuildSlot(matchState: MatchState, cleanupStatus: CleanupStatus): boolean {
  return !isTerminalMatchState(matchState) || !['NOT_REQUIRED', 'COMPLETE'].includes(cleanupStatus);
}
