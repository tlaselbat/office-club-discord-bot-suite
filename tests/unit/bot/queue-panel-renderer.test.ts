import { describe, expect, it } from 'vitest';
import { ComponentType, MessageFlags } from 'discord.js';
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

type ContainerComponent = {
  type: ComponentType;
  content?: string;
  components?: { custom_id?: string; label?: string; disabled?: boolean }[];
};

function container(payload: ReturnType<typeof renderQueuePanel>) {
  const first = payload.components[0];
  if (first === undefined) throw new Error('Expected a container');
  return first.toJSON();
}

function blocks(payload: ReturnType<typeof renderQueuePanel>): ContainerComponent[] {
  return container(payload).components as ContainerComponent[];
}

function texts(payload: ReturnType<typeof renderQueuePanel>): string[] {
  return blocks(payload)
    .filter((component) => component.type === ComponentType.TextDisplay)
    .map((component) => component.content ?? '');
}

function allText(payload: ReturnType<typeof renderQueuePanel>): string {
  return texts(payload).join('\n');
}

function buttonRows(payload: ReturnType<typeof renderQueuePanel>) {
  return blocks(payload).filter((component) => component.type === ComponentType.ActionRow);
}

function buttons(payload: ReturnType<typeof renderQueuePanel>) {
  return buttonRows(payload).flatMap((row) => row.components ?? []);
}

function buttonLabels(payload: ReturnType<typeof renderQueuePanel>) {
  return buttons(payload).map((component) => component.label);
}

describe('queue panel renderer (Components V2)', () => {
  it('sends a Components V2 payload in a single accent container', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    expect(container(payload).accent_color).toBe(0x5865f2);
    expect('embeds' in payload).toBe(false);
  });

  it('renders the open queue hierarchy: title, description, summary, lifecycle, roster', () => {
    const payload = renderQueuePanel(
      view({ queueCount: 1, playerDisplayNames: ['tablet.'] }),
      secret,
    );
    const text = allText(payload);
    expect(text).toContain('## CS2 10man');
    expect(text).toContain('private 5v5 CS2 match');
    expect(text).toContain('**Queue**\n1 / 10');
    expect(text).toContain('**Status**\nWaiting for 9 more players');
    expect(text).toContain('Queue → Ready Check → Teams → Map → Server → Match');
    expect(text).toContain('**Players in Queue · 1**');
    expect(text).toContain('1. tablet.');
  });

  it('does not render a redundant Needed section', () => {
    const payload = renderQueuePanel(view({ queueCount: 1 }), secret);
    expect(allText(payload)).not.toContain('Needed');
  });

  it('renders an empty queue', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(allText(payload)).toContain('0 / 10');
    expect(allText(payload)).toContain('No players queued.');
  });

  it('uses singular wording when one player is needed', () => {
    const payload = renderQueuePanel(
      view({
        queueCount: 9,
        playerDisplayNames: Array.from({ length: 9 }, (_, i) => `p${String(i)}`),
      }),
      secret,
    );
    expect(allText(payload)).toContain('Waiting for 1 more player');
  });

  it('marks a full queue as starting the ready check', () => {
    const names = Array.from({ length: 10 }, (_, i) => `player-${String(i)}`);
    const payload = renderQueuePanel(view({ queueCount: 10, playerDisplayNames: names }), secret);
    expect(allText(payload)).toContain('Queue full — starting ready check');
    expect(allText(payload)).toContain('10. player-9');
  });

  it('honors a configured capacity instead of hardcoding ten', () => {
    const payload = renderQueuePanel(view({ queueCapacity: 6, queueCount: 4 }), secret);
    expect(allText(payload)).toContain('4 / 6');
    expect(allText(payload)).toContain('6 players');
  });

  it('renders the locked queue with plain-language status and no join control', () => {
    const payload = renderQueuePanel(
      view({ queueOpen: false, activeMatchState: 'SERVER_PROVISIONING' }),
      secret,
    );
    const text = allText(payload);
    expect(text).toContain('reopen automatically');
    expect(text).toContain('Preparing server — match in progress');
    expect(text).not.toContain('SERVER_PROVISIONING');
    const labels = buttonLabels(payload);
    expect(labels).not.toContain('Join Queue');
    expect(labels).toEqual(
      expect.arrayContaining(['Lobby Status', 'Steam Account', 'How It Works', 'Refresh']),
    );
  });

  it('shows cleanup wording for terminal locked queues', () => {
    const payload = renderQueuePanel(
      view({ queueOpen: false, activeMatchState: 'FINISHED' }),
      secret,
    );
    expect(allText(payload)).toContain('Queue reopening after cleanup');
  });

  it('orders roster entries and truncates long names within component limits', () => {
    const long = 'x'.repeat(200);
    const payload = renderQueuePanel(
      view({ queueCount: 3, playerDisplayNames: [long, 'b', 'a'] }),
      secret,
    );
    const roster = texts(payload).find((content) => content.includes('2. b')) ?? '';
    expect(roster).toContain('1. ');
    expect(roster).toContain('3. a');
    expect(roster.length).toBeLessThanOrEqual(4000);
  });

  it('exposes the expected open-state controls inside the container', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(buttonLabels(payload)).toEqual([
      'Join Queue',
      'Lobby Status',
      'Steam Account',
      'How It Works',
      'Refresh',
    ]);
    // No legacy "My 10man" label may survive on the public panel.
    expect(buttonLabels(payload)).not.toContain('My 10man');
  });

  it('uses separators between major regions', () => {
    const payload = renderQueuePanel(view(), secret);
    const separators = blocks(payload).filter(
      (component) => component.type === ComponentType.Separator,
    );
    expect(separators.length).toBeGreaterThanOrEqual(3);
  });

  it('signs component IDs and binds mutating controls to the queue version', () => {
    const payload = renderQueuePanel(view(), secret);
    const join = buttons(payload)[0];
    expect(join?.custom_id?.startsWith('tmq:JOIN:')).toBe(true);
    const parsed = parseQueueCustomId(join?.custom_id ?? '', secret);
    expect(parsed).toEqual({ action: 'JOIN', guildId, version: 7 });
    const steam = buttons(payload).find((component) => component.label === 'Steam Account');
    expect(parseSteamAccountCustomId(steam?.custom_id ?? '', secret).action).toBe('VIEW');
  });

  it('never puts sensitive values into custom IDs', () => {
    const payload = renderQueuePanel(
      view({ playerDisplayNames: ['76561198000000000', 'password123'] }),
      secret,
    );
    for (const component of buttons(payload)) {
      expect(component.custom_id).not.toContain('76561198000000000');
      expect(component.custom_id).not.toContain('password123');
    }
  });
});

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
