import { describe, expect, it } from 'vitest';
import {
  createPlayerAdminCustomId,
  parsePlayerAdminCustomId,
} from '../../../src/modules/tenman/bot/player-admin-custom-id.js';

const secret = 'player-admin-secret';
const payload = {
  action: 'RS' as const,
  guildId: '123456789012345678',
  targetDiscordUserId: '223456789012345678',
  actorDiscordUserId: '323456789012345678',
  expiresAt: 2_000,
};

describe('signed player statistics reset controls', () => {
  it('round-trips recipient, actor, guild, and expiry bindings', () => {
    const customId = createPlayerAdminCustomId(payload, secret);
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parsePlayerAdminCustomId(customId, secret, 1_999_000)).toEqual(payload);
  });

  it('rejects tampering and expiry', () => {
    const customId = createPlayerAdminCustomId(payload, secret);
    expect(() => parsePlayerAdminCustomId(customId.replace('223456', '923456'), secret, 0)).toThrow(
      'signature',
    );
    expect(() => parsePlayerAdminCustomId(customId, secret, 2_001_000)).toThrow('expired');
  });
});
