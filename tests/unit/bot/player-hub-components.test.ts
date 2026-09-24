import { describe, expect, it } from 'vitest';
import { buildPlayerHubResponse } from '../../../src/modules/tenman/bot/player-hub-components.js';
import { parseQueueCustomId } from '../../../src/modules/tenman/bot/queue-custom-id.js';
import { parseMatchCustomId } from '../../../src/modules/tenman/bot/match-custom-id.js';
import type { PlayerStatus } from '../../../src/modules/tenman/services/player-status-service.js';

const secret = 'hub-test-secret';
const guildId = '123456789012345678';
const userId = '223456789012345678';
const matchId = '123e4567-e89b-12d3-a456-426614174000';

function render(status: PlayerStatus) {
  return buildPlayerHubResponse(status, guildId, userId, 5, 3, 2, secret);
}

function embed(response: ReturnType<typeof render>) {
  const first = response.embeds[0];
  if (first === undefined) throw new Error('Expected an embed');
  return first.toJSON();
}

function buttons(response: ReturnType<typeof render>) {
  return response.components.flatMap((row) =>
    row.toJSON().components.map((component) => ({
      label: 'label' in component ? component.label : undefined,
      customId:
        'custom_id' in component && typeof component.custom_id === 'string'
          ? component.custom_id
          : '',
      disabled: 'disabled' in component ? component.disabled : false,
    })),
  );
}

function labels(response: ReturnType<typeof render>) {
  return buttons(response).map((button) => button.label);
}

describe('My 10man personal interface', () => {
  it('new player: no Steam account, not queued, direct assign action', () => {
    const response = render({ kind: 'NEW_PLAYER' });
    expect(embed(response).title).toBe('Your 10man');
    const fieldNames = (embed(response).fields ?? []).map((field) => field.name);
    expect(fieldNames).toEqual(['Steam account', 'Queue']);
    expect(embed(response).fields?.[0]?.value).toBe('Not assigned');
    expect(embed(response).fields?.[1]?.value).toBe('Not joined');
    expect(labels(response)).toContain('Assign Steam Account');
  });

  it('ready to join: join and steam account actions', () => {
    const response = render({ kind: 'READY_TO_QUEUE', queueSize: 10, playersInQueue: 4 });
    expect(embed(response).fields?.map((field) => field.value)).toContain('4 / 10 players');
    const all = buttons(response);
    expect(labels(response)).toEqual(
      expect.arrayContaining(['Join Queue', 'Steam Account', 'How It Works', 'Refresh']),
    );
    const join = all.find((button) => button.label === 'Join Queue');
    expect(parseQueueCustomId(join?.customId ?? '', secret)).toEqual({
      action: 'JOIN',
      guildId,
      version: 5,
    });
  });

  it('queued: position, count, waiting copy, leave and refresh', () => {
    const response = render({ kind: 'QUEUED', position: 4, playersInQueue: 7, queueSize: 10 });
    const data = embed(response);
    expect(data.description).toContain('Waiting for 3 more players');
    const values = (data.fields ?? []).map((field) => `${field.name}:${field.value}`);
    expect(values).toContain('Status:In queue');
    expect(values).toContain('Position:4');
    expect(values).toContain('Players:7 / 10');
    const all = buttons(response);
    expect(labels(response)).toEqual(expect.arrayContaining(['Leave Queue', 'Refresh']));
    const leave = all.find((button) => button.label === 'Leave Queue');
    expect(parseQueueCustomId(leave?.customId ?? '', secret).action).toBe('LEAVE');
  });

  it('ready check: reuses signed match ready/withdraw controls', () => {
    const response = render({
      kind: 'READY_CHECK',
      matchId,
      deadlineAt: new Date('2026-09-24T00:00:00Z'),
      ready: false,
    });
    expect(embed(response).description).toContain('Ready check');
    const all = buttons(response);
    const ready = all.find((button) => button.label === "I'm Ready");
    const withdraw = all.find((button) => button.label === 'Withdraw');
    expect(ready).toBeDefined();
    expect(withdraw).toBeDefined();
    expect(parseMatchCustomId(ready?.customId ?? '', secret)).toMatchObject({
      action: 'READY',
      matchId,
      version: 3,
      phaseGeneration: 2,
    });
    expect(parseMatchCustomId(withdraw?.customId ?? '', secret).action).toBe('WITHDRAW_READY');
  });

  it('match active: readable phase, map, and My Match Info navigation', () => {
    const response = render({
      kind: 'MATCH_ACTIVE',
      matchId,
      state: 'SERVER_PROVISIONING',
      selectedMap: null,
    });
    const data = embed(response);
    const values = (data.fields ?? []).map((field) => `${field.name}:${field.value}`);
    expect(values).toContain('Phase:Preparing server');
    expect(values).toContain('Map:Pending');
    expect(JSON.stringify(data)).not.toContain('SERVER_PROVISIONING');
    const info = buttons(response).find((button) => button.label === 'My Match Info');
    expect(parseMatchCustomId(info?.customId ?? '', secret).action).toBe('MY_MATCH_INFO');
  });

  it('terminal: cleanup copy, no raw enum, rejoin action', () => {
    const response = render({ kind: 'TERMINAL', matchId, state: 'FINISHED' });
    expect(embed(response).description).toContain('Cleanup is finishing');
    expect(JSON.stringify(embed(response))).not.toContain('FINISHED');
    expect(labels(response)).toEqual(
      expect.arrayContaining(['Join Queue Again', 'Refresh', 'Report Result Issue']),
    );
  });
});
