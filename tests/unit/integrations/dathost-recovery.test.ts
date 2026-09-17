import { describe, expect, it } from 'vitest';
import {
  assertDeletionAllowed,
  reconcileDuplicate,
} from '../../../src/modules/tenman/integrations/dathost/duplicate-recovery.js';
import type { DatHostServer } from '../../../src/modules/tenman/integrations/dathost/schemas.js';

const baseAttempt = {
  persistedServerId: null,
  ownershipMarker: 'tenman:match-id',
  provisionalName: '10man-mat-abc-attempt-def',
  location: 'dallas',
  requestStartedAt: new Date('2026-01-01T00:00:00Z'),
  requestFinishedAt: new Date('2026-01-01T00:00:10Z'),
  templateServerIds: new Set(['template']),
};
const server = (overrides: Partial<DatHostServer> = {}): DatHostServer => ({
  id: 'duplicate',
  name: baseAttempt.provisionalName,
  location: 'dallas',
  created_at: Date.parse('2026-01-01T00:00:05Z') / 1000,
  booting: false,
  ...overrides,
});

describe('DatHost duplicate recovery', () => {
  it('prefers user_data over fallback correlation', () => {
    const result = reconcileDuplicate(baseAttempt, [
      server({ user_data: baseAttempt.ownershipMarker }),
    ]);
    expect(result.status).toBe('ADOPT');
    if (result.status === 'ADOPT') expect(result.evidence).toBe('USER_DATA');
  });

  it('requires review for ambiguous fallback candidates', () => {
    const result = reconcileDuplicate(baseAttempt, [server({ id: 'one' }), server({ id: 'two' })]);
    expect(result.status).toBe('AMBIGUOUS');
  });

  it('never treats the template as an adoptable candidate', () => {
    expect(reconcileDuplicate(baseAttempt, [server({ id: 'template' })]).status).toBe('PENDING');
  });

  it('requires exact ownership and rejects template deletion', () => {
    expect(() => assertDeletionAllowed('unknown', 'owned', new Set())).toThrow('ownership');
    expect(() => assertDeletionAllowed('template', 'template', new Set(['template']))).toThrow(
      'Protected',
    );
  });
});
