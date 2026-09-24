import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { renderQueuePanel } from '../../../src/modules/tenman/bot/queue-panel-renderer.js';
import { parseQueueCustomId } from '../../../src/modules/tenman/bot/queue-custom-id.js';
import { parseSteamAccountCustomId } from '../../../src/modules/tenman/bot/steam-account-custom-id.js';
import {
  matchPhaseLabel,
  playersNeededLabel,
} from '../../../src/modules/tenman/bot/presentation.js';

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

type JSONMedia = {
  url?: string;
};

type JSONComponent = {
  type: ComponentType;
  content?: string;
  accent_color?: number;
  components?: JSONComponent[];
  custom_id?: string;
  label?: string;
  disabled?: boolean;
  style?: number;
  accessory?: {
    type: ComponentType;
    media?: JSONMedia;
  };
};

function topLevelJSON(payload: ReturnType<typeof renderQueuePanel>): JSONComponent[] {
  return payload.components.map((component) => component.toJSON() as JSONComponent);
}

function textDisplays(root: JSONComponent): JSONComponent[] {
  const results: JSONComponent[] = [];
  const stack: JSONComponent[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (current.type === ComponentType.TextDisplay && current.content !== undefined) {
      results.push(current);
    }
    if (current.components !== undefined) {
      stack.push(...current.components);
    }
  }
  return results;
}

function allText(payload: ReturnType<typeof renderQueuePanel>): string {
  return topLevelJSON(payload)
    .flatMap((component) => textDisplays(component).map((display) => display.content ?? ''))
    .join('\n');
}

function summary(payload: ReturnType<typeof renderQueuePanel>): JSONComponent {
  const [component] = topLevelJSON(payload);
  expect(component).toBeDefined();
  return component as JSONComponent;
}

function roster(payload: ReturnType<typeof renderQueuePanel>): JSONComponent {
  const [, component] = topLevelJSON(payload);
  expect(component).toBeDefined();
  return component as JSONComponent;
}

function buttons(payload: ReturnType<typeof renderQueuePanel>): JSONComponent[] {
  return topLevelJSON(payload)
    .filter((component) => component.type === ComponentType.ActionRow)
    .flatMap((row) => row.components ?? []);
}

function buttonLabels(payload: ReturnType<typeof renderQueuePanel>): string[] {
  return buttons(payload).map((component) => component.label ?? '');
}

describe('queue panel renderer (Components V2)', () => {
  it('sends a Components V2 payload with summary and roster containers plus action rows', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect('embeds' in payload).toBe(false);

    const top = topLevelJSON(payload);
    expect(top).toHaveLength(4);
    expect(top.map((component) => component.type)).toEqual([
      ComponentType.Container,
      ComponentType.Container,
      ComponentType.ActionRow,
      ComponentType.ActionRow,
    ]);
    expect(top[0]?.accent_color).toBe(0x5865f2);
    expect(top[1]?.accent_color).toBeUndefined();

    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]?.name).toBe('office-club-cs2-10man-thumbnail-512.png');
  });

  it('limits the thumbnail Section to the header and renders status at container width', () => {
    const payload = renderQueuePanel(view({ queueCount: 1 }), secret);
    const summaryContainer = summary(payload);
    expect(summaryContainer.components?.map((component) => component.type)).toEqual([
      ComponentType.Section,
      ComponentType.TextDisplay,
      ComponentType.TextDisplay,
    ]);

    const header = summaryContainer.components?.[0];
    expect(header?.components?.map((component) => component.content)).toEqual([
      '## Match Queue',
      '-# Private 5v5 CS2 matchmaking.',
    ]);
    expect(header?.accessory?.type).toBe(ComponentType.Thumbnail);
    expect(header?.accessory?.media?.url).toBe(
      'attachment://office-club-cs2-10man-thumbnail-512.png',
    );
    expect(summaryContainer.components?.[1]?.content).toBe(
      '**1 / 10 players**\n-# Waiting for 9 more players',
    );
    expect(summaryContainer.components?.[2]?.content).toBe(
      '**Next**\nReady Check when the queue reaches 10',
    );
  });

  it('renders the open queue hierarchy in the summary container', () => {
    const payload = renderQueuePanel(
      view({ queueCount: 1, playerDisplayNames: ['tablet.'] }),
      secret,
    );
    const summaryText = textDisplays(summary(payload))
      .map((display) => display.content)
      .join('\n');
    expect(summaryText).toContain('## Match Queue');
    expect(summaryText).toContain('-# Private 5v5 CS2 matchmaking.');
    expect(summaryText).toContain('**1 / 10 players**');
    expect(summaryText).toContain('-# Waiting for 9 more players');
    expect(summaryText).toContain('**Next**');
    expect(summaryText).toContain('Ready Check when the queue reaches 10');
    expect(summaryText).not.toContain('Ready Check → Teams → Map → Server → Match');
    expect(summaryText.match(/(^|\n)#{1,6}\s/g)).toHaveLength(1);
    expect(summaryText).not.toContain('Waiting for **');
  });

  it('renders the roster in a separate container', () => {
    const payload = renderQueuePanel(
      view({ queueCount: 1, playerDisplayNames: ['tablet.'] }),
      secret,
    );
    const rosterText = textDisplays(roster(payload))
      .map((display) => display.content)
      .join('\n');
    expect(rosterText).toContain('**Queued Players · 1**');
    expect(rosterText).not.toMatch(/(^|\n)#{1,6}\s/);
    expect(rosterText).toContain('`01` tablet.');
    expect(rosterText).not.toContain('[tablet.]');
  });

  it('does not render a redundant Needed section', () => {
    const payload = renderQueuePanel(view({ queueCount: 1 }), secret);
    expect(allText(payload)).not.toContain('Needed');
  });

  it('renders an empty queue', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(allText(payload)).toContain('**0 / 10 players**');
    expect(allText(payload)).toContain('-# Waiting for 10 more players');
    expect(allText(payload)).toContain('-# No players queued.');
  });

  it('uses singular wording when one player is needed', () => {
    const payload = renderQueuePanel(
      view({
        queueCount: 9,
        playerDisplayNames: Array.from({ length: 9 }, (_, i) => `p${String(i)}`),
      }),
      secret,
    );
    expect(allText(payload)).toContain('-# Waiting for 1 more player');
  });

  it('marks a full queue as starting the ready check', () => {
    const names = Array.from({ length: 10 }, (_, i) => `player-${String(i)}`);
    const payload = renderQueuePanel(view({ queueCount: 10, playerDisplayNames: names }), secret);
    expect(allText(payload)).toContain('**10 / 10 players**');
    expect(allText(payload)).toContain('-# Ready check starting');
    expect(allText(payload)).toContain('`10` player-9');
  });

  it('honors a configured capacity instead of hardcoding ten', () => {
    const payload = renderQueuePanel(view({ queueCapacity: 6, queueCount: 4 }), secret);
    expect(allText(payload)).toContain('**4 / 6 players**');
    expect(allText(payload)).toContain('-# Waiting for 2 more players');
    expect(allText(payload)).toContain('Ready Check when the queue reaches 6');
  });

  it('renders the locked queue with plain-language status and no join control', () => {
    const payload = renderQueuePanel(
      view({ queueOpen: false, activeMatchState: 'SERVER_PROVISIONING' }),
      secret,
    );
    const top = topLevelJSON(payload);
    expect(top.map((component) => component.type)).toEqual([
      ComponentType.Container,
      ComponentType.ActionRow,
      ComponentType.ActionRow,
    ]);
    const text = allText(payload);
    expect(text).toContain('**Match in progress**');
    expect(text).toContain('-# The queue will reopen when the match finishes.');
    expect(text).not.toContain('SERVER_PROVISIONING');
    const labels = buttonLabels(payload);
    expect(labels).not.toContain('Join Queue');
    expect(labels).toEqual(
      expect.arrayContaining(['Match Center', 'Steam Account', 'How It Works', 'Refresh']),
    );
  });

  it('shows cleanup wording for terminal locked queues', () => {
    const payload = renderQueuePanel(
      view({ queueOpen: false, activeMatchState: 'FINISHED' }),
      secret,
    );
    expect(allText(payload)).toContain('**Queue reopening**');
    expect(allText(payload)).toContain('-# Cleanup is finishing before the next queue opens.');
  });

  it('orders roster entries and truncates long names within component limits', () => {
    const long = 'x'.repeat(200);
    const payload = renderQueuePanel(
      view({ queueCount: 3, playerDisplayNames: [long, 'b', 'a'] }),
      secret,
    );
    const rosterText = textDisplays(roster(payload))
      .map((display) => display.content ?? '')
      .join('\n');
    expect(rosterText).toContain('`01`');
    expect(rosterText).toContain('`02` b');
    expect(rosterText).toContain('`03` a');
    expect(rosterText.length).toBeLessThanOrEqual(4000);
  });

  it('exposes the expected open-state controls in order', () => {
    const payload = renderQueuePanel(view(), secret);
    expect(buttonLabels(payload)).toEqual([
      'Join Queue',
      'Match Center',
      'Steam Account',
      'How It Works',
      'Refresh',
    ]);
    // No legacy "My 10man" label may survive on the public panel.
    expect(buttonLabels(payload)).not.toContain('My 10man');
  });

  it('keeps Join Queue as success and Match Center as primary', () => {
    const payload = renderQueuePanel(view(), secret);
    const join = buttons(payload).find((component) => component.label === 'Join Queue');
    const lobby = buttons(payload).find((component) => component.label === 'Match Center');
    expect(join?.style).toBe(ButtonStyle.Success);
    expect(lobby?.style).toBe(ButtonStyle.Primary);
  });

  it('does not add visible separators between native Containers', () => {
    const payload = renderQueuePanel(view(), secret);
    const separators = topLevelJSON(payload).filter(
      (component) => component.type === ComponentType.Separator,
    );
    expect(separators).toHaveLength(0);
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
