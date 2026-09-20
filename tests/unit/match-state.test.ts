import { describe, expect, it } from 'vitest';
import {
  canTransitionMatch,
  occupiesGuildSlot,
  transitionMatch,
} from '../../src/modules/tenman/domain/match-state.js';

describe('match state machine', () => {
  it('allows the expected forward lifecycle', () => {
    expect(canTransitionMatch('CREATED', 'READY_CHECK')).toBe(true);
    expect(canTransitionMatch('READY_CHECK', 'TEAM_SELECTION')).toBe(true);
    expect(canTransitionMatch('TEAM_SELECTION', 'MAP_VETO')).toBe(true);
    expect(canTransitionMatch('MAP_VETO', 'TEAMS_LOCKED')).toBe(true);
    expect(canTransitionMatch('TEAMS_LOCKED', 'SERVER_PROVISIONING')).toBe(true);
    expect(canTransitionMatch('LIVE', 'FINISHED')).toBe(true);
  });

  it('rejects skipping lifecycle stages', () => {
    expect(() => transitionMatch('CREATED', 'LIVE')).toThrow('Illegal match transition');
    expect(() => transitionMatch('READY_CHECK', 'MAP_VETO')).toThrow('Illegal match transition');
  });

  it('allows nonterminal states to fail or cancel', () => {
    expect(canTransitionMatch('SERVER_BOOTING', 'FAILED')).toBe(true);
    expect(canTransitionMatch('WARMUP', 'CANCELED')).toBe(true);
  });

  it('keeps a terminal match in the guild slot until cleanup settles', () => {
    expect(occupiesGuildSlot('FINISHED', 'RETRY')).toBe(true);
    expect(occupiesGuildSlot('FINISHED', 'COMPLETE')).toBe(false);
    expect(occupiesGuildSlot('CANCELED', 'NOT_REQUIRED')).toBe(false);
  });
});
