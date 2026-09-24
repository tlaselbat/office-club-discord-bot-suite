import { describe, expect, it } from 'vitest';
import {
  compactMatchUuid,
  createResultDisputeCustomId,
  expandMatchUuid,
  parseResultDisputeCustomId,
} from '../../../src/modules/tenman/bot/match-result-dispute-custom-id.js';

const secret = 'test-secret';
const matchId = '550e8400-e29b-41d4-a716-446655440000';

const base = {
  action: 'REPORT' as const,
  guildId: '12345678901234567',
  actorDiscordUserId: '98765432109876543',
  matchId: compactMatchUuid(matchId),
};

describe('match-result-dispute custom id', () => {
  it('round-trips a report payload', () => {
    const customId = createResultDisputeCustomId(base, secret);
    expect(customId.length).toBeLessThanOrEqual(100);

    const parsed = parseResultDisputeCustomId(customId, secret);
    expect(parsed).toEqual(base);
  });

  it('round-trips a modal payload', () => {
    const modalPayload = { ...base, action: 'MODAL' as const };
    const customId = createResultDisputeCustomId(modalPayload, secret);

    const parsed = parseResultDisputeCustomId(customId, secret);
    expect(parsed).toEqual(modalPayload);
  });

  it('rejects a tampered custom id', () => {
    const customId = createResultDisputeCustomId(base, secret);
    const tampered = customId.replace('REPORT', 'MODAL');

    expect(() => parseResultDisputeCustomId(tampered, secret)).toThrow('signature');
  });

  it('expands a compact match uuid', () => {
    expect(expandMatchUuid(compactMatchUuid(matchId))).toBe(matchId);
  });
});
