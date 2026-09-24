import { describe, expect, it } from 'vitest';
import { renderQueuePanel } from '../../../src/modules/tenman/bot/queue-panel-renderer.js';
import { parseQueueCustomId } from '../../../src/modules/tenman/bot/queue-custom-id.js';
import { parseSteamAccountCustomId } from '../../../src/modules/tenman/bot/steam-account-custom-id.js';
import { matchPhaseLabel, playersNeededLabel } from '../../../src/modules/tenman/bot/presentation.js';

const secret = 'renderer-test-secret';
const guildId = '123456789012345678';

function view(overrides: Partial<Parameters<typeof renderQueuePanel>[0]> = {}) {
  return {
    guildId,
    version: 7,
    queueOpen: true,
    queueCount: 0,
    queueCapacity: 10,
    playerDisplayNames: [] as string[],
    ...overrides,
  };
}

function firstEmbed(payload: ReturnType<typeof renderQueuePanel>) {
  const embed = payload.embeds[0];
  if (embed === undefined) throw new Error('Expected an embed');
  return embed.toJSON();
}

function fields(payload: ReturnType<typeof renderQueuePanel>) {
  return firstEmbed(payload).fields ?? [];
}

function field(payload: ReturnType<typeof renderQueuePanel>, name: string) {
  return fields(payload).find((candidate) => candidate.name.startsWith(name));
}

function buttonLabels(payload: ReturnType<typeof renderQueuePanel>) {
  return payload.components.flatMap((row) =>
    row.toJSON().components.map((component) => ('label' in component ? component.label : '')),
  );
}

describe('queue panel renderer', () => {
  it('renders the open queue hierarchy: title, summary fields, lifecycle, roster', () => {
    const payload = renderQueuePanel(
      view({ queueCount: 1, playerDisplayNames: ['tablet.'] }),
      secret,
    );
    const embed = firstEmbed(payload);
    expect(embed.title).toBe('CS2 10man');
    expect(embed.description).toContain('private 5v5 CS2 match');
    expect(field(payload, 'Queue')?.value).toBe('1 / 10');
    expect(field(payload, 'Needed')?.value).toBe('9 more players');
    expect(field(payload, 'Status')?.value).toBe('Waiting for 9 more players');
    expect(field(payload, 'Next')?.value).toBe(
      'Queue → Ready Check → Teams → Map → Server → Match',
    );
    expect(field(payload, 'Players in Queue')?.name).toBe('Players in Queue — 1');
    expect(field(payload, 'Players in Queue')?.value).toBe('1. tablet.');
  });

  it('renders an empty queue', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(field(payload, 'Queue')?.value).toBe('0 / 10');
    expect(field(payload, 'Needed')?.value).toBe('10 more players');
    expect(field(payload, 'Players in Queue')?.value).toBe('No players queued.');
  });

  it('uses singular wording when one player is needed', () => {
    const payload = renderQueuePanel(
      view({ queueCount: 9, playerDisplayNames: Array.from({ length: 9 }, (_, i) => `p${String(i)}`) }),
      secret,
    );
    expect(field(payload, 'Needed')?.value).toBe('1 more player');
    expect(field(payload, 'Status')?.value).toBe('Waiting for 1 more player');
  });

  it('marks a full queue as starting the ready check', () => {
    const names = Array.from({ length: 10 }, (_, i) => `player-${String(i)}`);
    const payload = renderQueuePanel(view({ queueCount: 10, playerDisplayNames: names }), secret);
    expect(field(payload, 'Needed')?.value).toBe('Queue full');
    expect(field(payload, 'Status')?.value).toBe('Queue full — starting ready check');
    expect(field(payload, 'Players in Queue')?.value).toContain('10. player-9');
  });

  it('honors a configured capacity instead of hardcoding ten', () => {
    const payload = renderQueuePanel(view({ queueCapacity: 6, queueCount: 4 }), secret);
    expect(field(payload, 'Queue')?.value).toBe('4 / 6');
    expect(embedDescription(payload)).toContain('6 players');
  });

  it('renders the locked queue with plain-language status and no join control', () => {
    const payload = renderQueuePanel(
      view({ queueOpen: false, activeMatchState: 'SERVER_PROVISIONING' }),
      secret,
    );
    expect(embedDescription(payload)).toContain('reopen automatically');
    expect(field(payload, 'Status')?.value).toBe('Preparing server — match in progress');
    const labels = buttonLabels(payload);
    expect(labels).not.toContain('Join Queue');
    expect(labels).toEqual(
      expect.arrayContaining(['My 10man', 'Steam Account', 'How It Works', 'Refresh']),
    );
  });

  it('shows cleanup wording for terminal locked queues', () => {
    const payload = renderQueuePanel(
      view({ queueOpen: false, activeMatchState: 'FINISHED' }),
      secret,
    );
    expect(field(payload, 'Status')?.value).toBe('Queue reopening after cleanup');
  });

  it('orders roster entries and truncates long names within field limits', () => {
    const long = 'x'.repeat(200);
    const payload = renderQueuePanel(
      view({ queueCount: 3, playerDisplayNames: [long, 'b', 'a'] }),
      secret,
    );
    const roster = field(payload, 'Players in Queue')?.value ?? '';
    expect(roster).toContain('1. ');
    expect(roster).toContain('2. b');
    expect(roster).toContain('3. a');
    expect(roster.length).toBeLessThanOrEqual(1024);
  });

  it('exposes the expected open-state controls in order', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(buttonLabels(payload)).toEqual([
      'Join Queue',
      'My 10man',
      'Steam Account',
      'How It Works',
      'Refresh',
    ]);
  });

  it('signs component IDs and binds mutating controls to the queue version', () => {
    const payload = renderQueuePanel(view(), secret);
    const join = payload.components[0]?.toJSON().components[0] as
      | { custom_id: string }
      | undefined;
    expect(join?.custom_id.startsWith('tmq:JOIN:')).toBe(true);
    const parsed = parseQueueCustomId(join?.custom_id ?? '', secret);
    expect(parsed).toEqual({ action: 'JOIN', guildId, version: 7 });
    const steam = payload.components[1]?.toJSON().components[0] as
      | { custom_id: string }
      | undefined;
    expect(parseSteamAccountCustomId(steam?.custom_id ?? '', secret).action).toBe('VIEW');
  });

  it('never puts sensitive values into custom IDs', () => {
    const payload = renderQueuePanel(
      view({ playerDisplayNames: ['76561198000000000', 'password123'] }),
      secret,
    );
    for (const row of payload.components) {
      for (const component of row.toJSON().components) {
        if ('custom_id' in component && typeof component.custom_id === 'string') {
          expect(component.custom_id).not.toContain('76561198000000000');
          expect(component.custom_id).not.toContain('password123');
        }
      }
    }
  });
});

function embedDescription(payload: ReturnType<typeof renderQueuePanel>): string {
  return firstEmbed(payload).description ?? '';
}

describe('presentation labels', () => {
  it('maps internal states to plain language', () => {
    expect(matchPhaseLabel('READY_CHECK')).toBe('Ready check');
    expect(matchPhaseLabel('MAP_VETO')).toBe('Choosing the map');
    expect(matchPhaseLabel('SERVER_PROVISIONING')).toBe('Preparing server');
    expect(matchPhaseLabel('LIVE')).toBe('Match live');
    expect(matchPhaseLabel('FAILED')).toBe("Match couldn't be started");
    expect(matchPhaseLabel('SOMETHING_NEW')).toBe('something new');
  });

  it('handles needed-player grammar', () => {
    expect(playersNeededLabel(0)).toBe('Queue full');
    expect(playersNeededLabel(1)).toBe('1 more player');
    expect(playersNeededLabel(9)).toBe('9 more players');
  });
});
