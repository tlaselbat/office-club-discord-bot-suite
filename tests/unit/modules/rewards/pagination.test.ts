import { describe, expect, it } from 'vitest';
import {
  buildRewardPageId,
  parseRewardPageId,
} from '../../../../src/modules/rewards/pagination.js';

const secret = 's'.repeat(32);
const payload = {
  guildId: '123456789012345678',
  requesterId: '223456789012345678',
  page: 2,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
};

describe('reward leaderboard pagination', () => {
  it('round trips a signed requester-bound page', () => {
    expect(parseRewardPageId(buildRewardPageId(payload, secret), secret)).toEqual(payload);
  });

  it('rejects tampering', () => {
    const customId = buildRewardPageId(payload, secret).replace(':2:', ':3:');
    expect(() => parseRewardPageId(customId, secret)).toThrow('signature');
  });
});
