import type { MatchState } from '../../domain/match-state.js';

export interface ActiveMatchStatus {
  matchId: string;
  matchzyMatchId: number;
  state: Extract<MatchState, 'MATCH_LOADED' | 'WARMUP' | 'LIVE' | 'PAUSED'>;
  lastEventAt: Date | null;
  updatedAt: Date;
}

export interface MatchZyObservation {
  observedAt: Date;
  matchzyMatchId: number;
  phase: 'LOADED' | 'WARMUP' | 'LIVE' | 'PAUSED' | 'FINISHED' | 'UNKNOWN';
  team1SeriesScore?: number;
  team2SeriesScore?: number;
  evidence: string;
  conclusive: boolean;
}

export type ReconciliationDecision =
  | { type: 'NO_CHANGE'; reason: string }
  | { type: 'JOURNAL_ONLY'; reason: string }
  | {
      type: 'CORRECT';
      targetState: Extract<MatchState, 'WARMUP' | 'LIVE' | 'PAUSED' | 'FINISHED'>;
      score?: { team1: number; team2: number };
      source: 'MATCHZY_RECONCILIATION';
    };

const phaseState = {
  WARMUP: 'WARMUP',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  FINISHED: 'FINISHED',
} as const;

export function shouldReconcile(
  match: ActiveMatchStatus,
  now: Date,
  staleAfterMs: number,
): boolean {
  const baseline = match.lastEventAt ?? match.updatedAt;
  return now.getTime() - baseline.getTime() >= staleAfterMs;
}

export function decideReconciliation(
  match: ActiveMatchStatus,
  observation: MatchZyObservation,
): ReconciliationDecision {
  if (observation.matchzyMatchId !== match.matchzyMatchId) {
    return { type: 'JOURNAL_ONLY', reason: 'Mismatched MatchZy match ID' };
  }
  if (
    !observation.conclusive ||
    observation.phase === 'UNKNOWN' ||
    observation.phase === 'LOADED'
  ) {
    return { type: 'JOURNAL_ONLY', reason: 'Observation is not conclusive enough to change state' };
  }
  const targetState = phaseState[observation.phase];
  if (targetState === match.state) return { type: 'NO_CHANGE', reason: 'State already matches' };
  if (targetState === 'FINISHED') {
    if (observation.team1SeriesScore === undefined || observation.team2SeriesScore === undefined) {
      return { type: 'JOURNAL_ONLY', reason: 'Completion lacks a conclusive score' };
    }
    return {
      type: 'CORRECT',
      targetState,
      score: { team1: observation.team1SeriesScore, team2: observation.team2SeriesScore },
      source: 'MATCHZY_RECONCILIATION',
    };
  }
  const legalForward: Readonly<Record<ActiveMatchStatus['state'], readonly MatchState[]>> = {
    MATCH_LOADED: ['WARMUP', 'LIVE'],
    WARMUP: ['LIVE'],
    LIVE: ['PAUSED'],
    PAUSED: ['LIVE'],
  };
  return legalForward[match.state].includes(targetState)
    ? { type: 'CORRECT', targetState, source: 'MATCHZY_RECONCILIATION' }
    : { type: 'JOURNAL_ONLY', reason: 'Observation would cause an illegal or backward transition' };
}
