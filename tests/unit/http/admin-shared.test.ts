import { describe, expect, it } from 'vitest';
import {
  isProductionReady,
  moduleReleasePolicy,
  serverNeedsAttention,
} from '../../../src/http/routes/admin/shared.js';

describe('admin shared helpers', () => {
  it('moduleReleasePolicy marks only game-servers as production-ready', () => {
    expect(moduleReleasePolicy['game-servers']).toBe('production_ready');
    expect(moduleReleasePolicy.competitive).toBe('in_development');
    expect(moduleReleasePolicy.rewards).toBe('in_development');
  });

  it('isProductionReady reflects the hardcoded release policy', () => {
    expect(isProductionReady('game-servers')).toBe(true);
    expect(isProductionReady('competitive')).toBe(false);
    expect(isProductionReady('rewards')).toBe(false);
  });

  it('serverNeedsAttention requires enabled server and a healthy snapshot', () => {
    expect(serverNeedsAttention({ enabled: false, snapshot: null })).toBe(false);
    expect(serverNeedsAttention({ enabled: true, snapshot: null })).toBe(true);
    expect(
      serverNeedsAttention({ enabled: true, snapshot: { stale: true, consecutiveFailures: 0 } }),
    ).toBe(true);
    expect(
      serverNeedsAttention({ enabled: true, snapshot: { stale: false, consecutiveFailures: 1 } }),
    ).toBe(true);
    expect(
      serverNeedsAttention({ enabled: true, snapshot: { stale: false, consecutiveFailures: 0 } }),
    ).toBe(false);
  });
});
