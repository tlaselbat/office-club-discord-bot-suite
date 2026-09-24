import { describe, expect, it } from 'vitest';
import {
  createMatchOpsCustomId,
  parseMatchOpsCustomId,
} from '../../../src/modules/tenman/bot/match-ops-custom-id.js';
import {
  createQueueAdminCustomId,
  parseQueueAdminCustomId,
} from '../../../src/modules/tenman/bot/queue-admin-custom-id.js';
import {
  createPartyCustomId,
  parsePartyCustomId,
} from '../../../src/modules/tenman/bot/party-custom-id.js';
import {
  createResultDisputeCustomId,
  parseResultDisputeCustomId,
} from '../../../src/modules/tenman/bot/match-result-dispute-custom-id.js';

const secret = 'test-secret';
const matchId = '123e4567-e89b-42d3-a456-426614174000';
const disputeId = '223e4567-e89b-42d3-a456-426614174000';
const partyId = '323e4567-e89b-42d3-a456-426614174000';
const inviteId = '423e4567-e89b-42d3-a456-426614174000';
const guildId = '1234567890123456789';
const actor = '9876543210987654321';

describe('match-ops custom id (tmo)', () => {
  it('round-trips with an optional staged target', () => {
    const payload = {
      action: 'RI' as const,
      matchId,
      version: 7,
      phaseGeneration: 3,
      actorDiscordUserId: actor,
      expiresAt: new Date(Math.floor((Date.now() + 60_000) / 1000) * 1000),
      targetDiscordUserId: '111111111111111111',
    };
    const id = createMatchOpsCustomId(payload, secret);
    expect(id.startsWith('tmo:')).toBe(true);
    expect(parseMatchOpsCustomId(id, secret)).toEqual(payload);
  });

  it('rejects tampering and expiry', () => {
    const base = {
      action: 'FR' as const,
      matchId,
      version: 1,
      phaseGeneration: 0,
      actorDiscordUserId: actor,
      expiresAt: new Date(Math.floor((Date.now() + 60_000) / 1000) * 1000),
    };
    const id = createMatchOpsCustomId(base, secret);
    expect(() => parseMatchOpsCustomId(`${id}x`, secret)).toThrow(
      'Invalid match-ops component signature',
    );
    expect(() =>
      parseMatchOpsCustomId(
        createMatchOpsCustomId({ ...base, expiresAt: new Date(Date.now() - 1000) }, secret),
        secret,
      ),
    ).toThrow('expired');
  });
});

describe('queue-admin custom id (tqb)', () => {
  it('round-trips the ban-modal variant carrying a target', () => {
    const payload = {
      action: 'BAN_MODAL' as const,
      guildId,
      actorDiscordUserId: actor,
      expiresAt: new Date(Math.floor((Date.now() + 60_000) / 1000) * 1000),
      targetDiscordUserId: '222222222222222222',
    };
    const id = createQueueAdminCustomId(payload, secret);
    expect(id.startsWith('tqb:')).toBe(true);
    expect(parseQueueAdminCustomId(id, secret)).toEqual(payload);
  });
});

describe('party custom id (tpy)', () => {
  it('round-trips panel and accept variants', () => {
    const panel = {
      action: 'PANEL' as const,
      guildId,
      actorDiscordUserId: actor,
    };
    expect(parsePartyCustomId(createPartyCustomId(panel, secret), secret)).toEqual(panel);
    const accept = {
      action: 'ACCEPT' as const,
      guildId,
      actorDiscordUserId: actor,
      inviteId,
    };
    expect(parsePartyCustomId(createPartyCustomId(accept, secret), secret)).toEqual(accept);
  });

  it('rejects a tampered id', () => {
    const id = createPartyCustomId(
      { action: 'DISBAND', guildId, actorDiscordUserId: actor, partyId },
      secret,
    );
    expect(() => parsePartyCustomId(`${id}tamper`, secret)).toThrow(
      'Invalid party component signature',
    );
  });
});

describe('result-dispute staff resolution ids (tmd)', () => {
  it('round-trips dispute id and resolution extras', () => {
    const payload = {
      action: 'RSM' as const,
      guildId,
      actorDiscordUserId: actor,
      disputeId,
      resolution: 'REVERSE' as const,
    };
    const id = createResultDisputeCustomId(payload, secret);
    expect(id.startsWith('tmd:')).toBe(true);
    expect(parseResultDisputeCustomId(id, secret)).toEqual(payload);
  });
});
