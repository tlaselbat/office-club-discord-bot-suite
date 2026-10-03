import { describe, expect, it } from 'vitest';
import { buildMatchCenterResponse } from '../../../src/modules/tenman/bot/player-hub-components.js';
import { parseMatchCustomId } from '../../../src/modules/tenman/bot/match-custom-id.js';
import type { PlayerStatus } from '../../../src/modules/tenman/services/player-status-service.js';

const secret = 'hub-test-secret';
const guildId = '123456789012345678';
const userId = '223456789012345678';
const matchId = '123e4567-e89b-12d3-a456-426614174000';

function render(status: PlayerStatus) {
  return buildMatchCenterResponse(status, guildId, userId, 5, 3, 2, secret);
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

describe('Player Center personal interface', () => {
  it('new player: no Steam account and no duplicate queue controls', () => {
    const response = render({ kind: 'NEW_PLAYER' });
    expect(embed(response).title).toBe('Player Center');
    const fieldNames = (embed(response).fields ?? []).map((field) => field.name);
    expect(fieldNames).toEqual(['Steam account', 'Queue']);
    expect(embed(response).fields?.[0]?.value).toBe('Not assigned');
    expect(embed(response).fields?.[1]?.value).toBe('Not joined');
    expect(labels(response)).not.toContain('Assign Steam Account');
  });

  it('ready to join: queue controls remain on the Match Queue panel', () => {
    const response = render({ kind: 'READY_TO_QUEUE', queueSize: 10, playersInQueue: 4 });
    expect(embed(response).fields?.map((field) => field.value)).toContain('4 / 10 players');
    const all = buttons(response);
    expect(labels(response)).toEqual(expect.arrayContaining(['Refresh', 'Match History']));
    expect(all.map((button) => button.label)).not.toEqual(
      expect.arrayContaining(['Join Queue', 'Steam Account', 'How It Works']),
    );
    // Navigation uses the renamed player-facing labels.
    expect(labels(response)).toContain('Team Status');
    expect(labels(response)).not.toContain('My Party');
    expect(labels(response)).not.toContain('My 10man');
  });

  it('queued: position, count, waiting copy, and no duplicate leave control', () => {
    const response = render({ kind: 'QUEUED', position: 4, playersInQueue: 7, queueSize: 10 });
    const data = embed(response);
    expect(data.description).toContain('Waiting for 3 more players');
    const values = (data.fields ?? []).map((field) => `${field.name}:${field.value}`);
    expect(values).toContain('Status:In queue');
    expect(values).toContain('Position:4');
    expect(values).toContain('Players:7 / 10');
    expect(labels(response)).toEqual(expect.arrayContaining(['Refresh']));
    expect(labels(response)).not.toContain('Leave Queue');
  });

  it('ready check: leaves ready controls on the Match Queue panel', () => {
    const response = render({
      kind: 'READY_CHECK',
      matchId,
      deadlineAt: new Date('2026-09-24T00:00:00Z'),
      ready: false,
    });
    expect(embed(response).description).toContain('Ready check');
    expect(labels(response)).toEqual(expect.arrayContaining(['Refresh']));
    expect(labels(response)).not.toEqual(expect.arrayContaining(["I'm Ready", 'Withdraw']));
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

  it('terminal: cleanup copy, no raw enum, and no duplicate rejoin action', () => {
    const response = render({ kind: 'TERMINAL', matchId, state: 'FINISHED' });
    expect(embed(response).description).toContain('Cleanup is finishing');
    expect(JSON.stringify(embed(response))).not.toContain('FINISHED');
    expect(labels(response)).toEqual(expect.arrayContaining(['Refresh', 'Report Result Issue']));
    expect(labels(response)).not.toContain('Join Queue Again');
  });
});
