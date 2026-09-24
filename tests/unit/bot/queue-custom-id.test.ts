import { describe, expect, it } from 'vitest';
import {
  createQueueCustomId,
  parseQueueCustomId,
} from '../../../src/modules/tenman/bot/queue-custom-id.js';

describe('signed queue component IDs', () => {
  it('round trips and rejects tampering', () => {
    const secret = 'test-secret';
    const id = createQueueCustomId(
      { action: 'JOIN', guildId: '123456789012345678', version: 42 },
      secret,
    );
    expect(parseQueueCustomId(id, secret)).toEqual({
      action: 'JOIN',
      guildId: '123456789012345678',
      version: 42,
    });
    expect(() => parseQueueCustomId(`${id}x`, secret)).toThrow('Invalid queue component');
  });

  it('round trips every supported action', () => {
    const secret = 'test-secret';
    for (const action of ['JOIN', 'LEAVE', 'LEAVE_CONFIRM', 'HOW_IT_WORKS', 'REFRESH'] as const) {
      const id = createQueueCustomId({ action, guildId: '123456789012345678', version: 3 }, secret);
      expect(parseQueueCustomId(id, secret).action).toBe(action);
      expect(id.length).toBeLessThanOrEqual(100);
    }
  });
});
