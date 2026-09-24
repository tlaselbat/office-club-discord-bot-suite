import { describe, expect, it } from 'vitest';
import {
  createSteamAccountCustomId,
  parseSteamAccountCustomId,
  type SteamAccountComponentPayload,
} from '../../../src/modules/tenman/bot/steam-account-custom-id.js';

const secret = 'test-secret';
const base: SteamAccountComponentPayload = {
  action: 'OPEN',
  guildId: '12345678901234567',
  actorDiscordUserId: '98765432109876543',
};

describe('steam-account custom id', () => {
  it('round-trips a basic payload', () => {
    const id = createSteamAccountCustomId(base, secret);
    expect(parseSteamAccountCustomId(id, secret)).toEqual(base);
  });

  it('round-trips a review payload with target and steam id', () => {
    const payload: SteamAccountComponentPayload = {
      ...base,
      action: 'REVIEW',
      targetDiscordUserId: '11111111111111111',
      steamId64: '76561198000000001',
    };
    const id = createSteamAccountCustomId(payload, secret);
    expect(parseSteamAccountCustomId(id, secret)).toEqual(payload);
  });

  it('round-trips a staff payload with a dispute id', () => {
    const payload: SteamAccountComponentPayload = {
      ...base,
      action: 'RESOLVE',
      disputeId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const id = createSteamAccountCustomId(payload, secret);
    expect(parseSteamAccountCustomId(id, secret)).toEqual(payload);
  });

  it('rejects a tampered custom id', () => {
    const id = createSteamAccountCustomId(base, secret);
    expect(() => parseSteamAccountCustomId(`${id}x`, secret)).toThrow(
      'Invalid steam-account component signature',
    );
  });
});
