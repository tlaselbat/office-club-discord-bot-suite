import { describe, expect, it } from 'vitest';
import {
  adminGeneration,
  createAdminCustomId,
  parseAdminCustomId,
} from '../../../src/modules/tenman/bot/admin-custom-id.js';

const secret = 'a'.repeat(32);
const payload = {
  action: 'TC' as const,
  guildId: '123456789012345678',
  actorDiscordUserId: '223456789012345678',
  settingsVersion: 42,
  generation: 'abc123_-',
  expiresAt: 2_000,
};

describe('admin custom IDs', () => {
  it('round-trips a signed persistent confirmation under Discord limits', () => {
    const customId = createAdminCustomId(payload, secret);
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAdminCustomId(customId, secret, 1_999_000)).toEqual(payload);
  });

  it('rejects tampering, another key, and expiry', () => {
    const customId = createAdminCustomId(payload, secret);
    expect(() => parseAdminCustomId(`${customId}x`, secret, 0)).toThrow();
    expect(() => parseAdminCustomId(customId, 'b'.repeat(32), 0)).toThrow();
    expect(() => parseAdminCustomId(customId, secret, 2_001_000)).toThrow('expired');
  });

  it('derives stable generation bindings', () => {
    expect(adminGeneration('123e4567-e89b-12d3-a456-426614174000', 1)).toBe(
      adminGeneration('123e4567-e89b-12d3-a456-426614174000', 1),
    );
    expect(adminGeneration(null, 1)).not.toBe(adminGeneration(null, 2));
  });
});
