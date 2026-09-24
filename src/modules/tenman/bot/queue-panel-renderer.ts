import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { buildLockedQueueControls, buildQueueControls } from './queue-components.js';
import { matchPhaseLabel, playersNeededLabel } from './presentation.js';

const ACCENT_COLOR = 0x5865f2;
const TEXT_DISPLAY_LIMIT = 4000;
const NAME_LIMIT = 48;
const LIFECYCLE = 'Queue → Ready Check → Teams → Map → Server → Match';

export interface QueuePanelView {
  guildId: string;
  version: number;
  queueOpen: boolean;
  queueCount: number;
  queueCapacity: number;
  playerDisplayNames: string[];
  /** Internal state of the guild's active match, when one exists. */
  activeMatchState?: string | null;
}

export interface QueuePanelPayload {
  flags: typeof MessageFlags.IsComponentsV2;
  components: ContainerBuilder[];
}

export function renderQueuePanel(view: QueuePanelView, secret: string): QueuePanelPayload {
  return view.queueOpen ? renderOpen(view, secret) : renderLocked(view, secret);
}

function renderOpen(view: QueuePanelView, secret: string): QueuePanelPayload {
  const playersNeeded = Math.max(0, view.queueCapacity - view.queueCount);
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## CS2 10man'),
      new TextDisplayBuilder().setContent(
        [
          'Join a private 5v5 CS2 match.',
          `When ${String(view.queueCapacity)} players are queued, everyone gets a ready check before teams and map selection.`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Queue**\n${String(view.queueCount)} / ${String(view.queueCapacity)}`,
      ),
      new TextDisplayBuilder().setContent(
        `**Status**\n${playersNeeded === 0
          ? 'Queue full — starting ready check'
          : `Waiting for ${playersNeededLabel(playersNeeded)}`
        }`,
      ),
      new TextDisplayBuilder().setContent(`**Next**\n${LIFECYCLE}`),
  )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Players in Queue · ${String(view.queueCount)}**`),
      new TextDisplayBuilder().setContent(formatRoster(view.playerDisplayNames)),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(...buildQueueControls(view.guildId, view.version, secret));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function renderLocked(view: QueuePanelView, secret: string): QueuePanelPayload {
  const phase = view.activeMatchState;
  const status =
    phase === null || phase === undefined
      ? 'Match currently in progress'
      : phase === 'FINISHED' || phase === 'CANCELED' || phase === 'FAILED'
        ? 'Queue reopening after cleanup'
        : `${matchPhaseLabel(phase)} — match in progress`;
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## CS2 10man'),
      new TextDisplayBuilder().setContent(
        'A 10man match is currently being formed or played. The queue will reopen automatically when cleanup finishes.',
      ),
  )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Status**\n${status}`),
      new TextDisplayBuilder().setContent(`**Next**\n${LIFECYCLE}`),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(...buildLockedQueueControls(view.guildId, view.version, secret));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function formatRoster(names: string[]): string {
  if (names.length === 0) return 'No players queued.';
  const lines: string[] = [];
  let used = 0;
  for (const [index, raw] of names.entries()) {
    const name = raw.length > NAME_LIMIT ? `${raw.slice(0, NAME_LIMIT - 1)}…` : raw;
    const line = `${String(index + 1)}. ${name}`;
    if (used + line.length + 1 > TEXT_DISPLAY_LIMIT - 32) {
      const remaining = names.length - index;
      lines.push(`…and ${String(remaining)} more`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
