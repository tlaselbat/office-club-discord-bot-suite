import { describe, expect, it } from 'vitest';
import {
  createPlayerHubCustomId,
  parsePlayerHubCustomId,
  type PlayerHubComponentPayload,
} from '../../../src/modules/tenman/bot/player-hub-custom-id.js';

const secret = 'test-secret';
const payload: PlayerHubComponentPayload = {
  action: 'HUB',
  guildId: '1234567890123456789',
  actorDiscordUserId: '9876543210987654321',
};

describe('player-hub custom id', () => {
  it('round-trips a valid payload', () => {
    const id = createPlayerHubCustomId(payload, secret);
    expect(parsePlayerHubCustomId(id, secret)).toEqual(payload);
  });

  it('rejects an invalid namespace', () => {
    expect(() => parsePlayerHubCustomId('bad:abc:123:456:sig', secret)).toThrow(
      'Invalid player-hub component namespace',
    );
  });

  it('rejects a tampered custom id', () => {
    const id = createPlayerHubCustomId(payload, secret);
    expect(() => parsePlayerHubCustomId(`${id}tamper`, secret)).toThrow(
      'Invalid player-hub component signature',
    );
  });
});
