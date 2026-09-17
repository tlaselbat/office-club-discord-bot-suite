import { describe, expect, it } from 'vitest';
import {
  decideReconciliation,
  shouldReconcile,
  type ActiveMatchStatus,
} from '../../../src/modules/tenman/integrations/matchzy/reconciliation.js';

const match: ActiveMatchStatus = {
  matchId: 'internal',
  matchzyMatchId: 42,
  state: 'LIVE',
  lastEventAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('MatchZy reconciliation', () => {
  it('detects stale active matches', () => {
    expect(shouldReconcile(match, new Date('2026-01-01T00:03:00Z'), 120_000)).toBe(true);
  });

  it('recovers a missed completion only from conclusive matching evidence', () => {
    expect(
      decideReconciliation(match, {
        observedAt: new Date(),
        matchzyMatchId: 42,
        phase: 'FINISHED',
        team1SeriesScore: 1,
        team2SeriesScore: 0,
        evidence: 'pinned-status-probe',
        conclusive: true,
      }),
    ).toEqual({
      type: 'CORRECT',
      targetState: 'FINISHED',
      score: { team1: 1, team2: 0 },
      source: 'MATCHZY_RECONCILIATION',
    });
  });

  it('journals mismatched or uncertain evidence without correction', () => {
    expect(
      decideReconciliation(match, {
        observedAt: new Date(),
        matchzyMatchId: 99,
        phase: 'FINISHED',
        evidence: 'other-server',
        conclusive: true,
      }).type,
    ).toBe('JOURNAL_ONLY');
  });
});
