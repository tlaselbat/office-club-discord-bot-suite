import {
  EmbedBuilder,
  type ActionRowBuilder,
  type APIEmbedField,
  type ButtonBuilder,
} from 'discord.js';
import { buildLockedQueueControls, buildQueueControls } from './queue-components.js';
import { matchPhaseLabel, playersNeededLabel } from './presentation.js';

const ACCENT_COLOR = 0x5865f2;
const FIELD_VALUE_LIMIT = 1024;
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
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

export function renderQueuePanel(view: QueuePanelView, secret: string): QueuePanelPayload {
  return view.queueOpen ? renderOpen(view, secret) : renderLocked(view, secret);
}

function renderOpen(view: QueuePanelView, secret: string): QueuePanelPayload {
  const playersNeeded = Math.max(0, view.queueCapacity - view.queueCount);
  const fields: APIEmbedField[] = [
    {
      name: 'Queue',
      value: `${String(view.queueCount)} / ${String(view.queueCapacity)}`,
      inline: true,
    },
    { name: 'Needed', value: playersNeededLabel(playersNeeded), inline: true },
    {
      name: 'Status',
      value:
        playersNeeded === 0
          ? 'Queue full — starting ready check'
          : `Waiting for ${playersNeededLabel(playersNeeded)}`,
      inline: true,
    },
    { name: 'Next', value: LIFECYCLE },
    {
      name: `Players in Queue — ${String(view.queueCount)}`,
      value: formatRoster(view.playerDisplayNames),
    },
  ];
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('CS2 10man')
        .setColor(ACCENT_COLOR)
        .setDescription(
          [
            'Join a private 5v5 CS2 match.',
            `When ${String(view.queueCapacity)} players are queued, everyone gets a ready check before teams and the map are selected.`,
          ].join('\n'),
        )
        .addFields(fields),
    ],
    components: buildQueueControls(view.guildId, view.version, secret),
  };
}

function renderLocked(view: QueuePanelView, secret: string): QueuePanelPayload {
  const phase = view.activeMatchState;
  const status =
    phase === null || phase === undefined
      ? 'Match currently in progress'
      : phase === 'FINISHED' || phase === 'CANCELED' || phase === 'FAILED'
        ? 'Queue reopening after cleanup'
        : `${matchPhaseLabel(phase)} — match in progress`;
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('CS2 10man')
        .setColor(ACCENT_COLOR)
        .setDescription(
          'A 10man match is currently being formed or played. The queue will reopen automatically when cleanup finishes.',
        )
        .addFields({ name: 'Status', value: status }, { name: 'Next', value: LIFECYCLE }),
    ],
    components: buildLockedQueueControls(view.guildId, view.version, secret),
  };
}

function formatRoster(names: string[]): string {
  if (names.length === 0) return 'No players queued.';
  const lines: string[] = [];
  let used = 0;
  for (const [index, raw] of names.entries()) {
    const name = raw.length > NAME_LIMIT ? `${raw.slice(0, NAME_LIMIT - 1)}…` : raw;
    const line = `${String(index + 1)}. ${name}`;
    if (used + line.length + 1 > FIELD_VALUE_LIMIT - 32) {
      const remaining = names.length - index;
      lines.push(`…and ${String(remaining)} more`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
