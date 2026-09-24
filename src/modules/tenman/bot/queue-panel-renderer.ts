import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AttachmentBuilder,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { buildLockedQueueControls, buildQueueControls } from './queue-components.js';
import { playersNeededLabel } from './presentation.js';

const ACCENT_COLOR = 0x5865f2;
const TEXT_DISPLAY_LIMIT = 4000;
const NAME_LIMIT = 48;
const LIFECYCLE = 'Ready Check → Teams → Map → Server → Match';
const THUMBNAIL_FILE_NAME = 'office-club-cs2-10man-thumbnail-512.png';
const THUMBNAIL_ASSET_PATH = resolve(process.cwd(), 'assets', 'tenman', THUMBNAIL_FILE_NAME);

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
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
  files: AttachmentBuilder[];
}

export function renderQueuePanel(view: QueuePanelView, secret: string): QueuePanelPayload {
  const attachment = buildThumbnailAttachment();
  const payload = view.queueOpen ? renderOpen(view, secret) : renderLocked(view, secret);
  return { ...payload, files: [attachment] };
}

function renderOpen(view: QueuePanelView, secret: string): Omit<QueuePanelPayload, 'files'> {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      buildSummaryContainer(view),
      buildRosterContainer(view),
      ...buildQueueControls(view.guildId, view.version, secret),
    ],
  };
}

function renderLocked(view: QueuePanelView, secret: string): Omit<QueuePanelPayload, 'files'> {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      buildLockedSummaryContainer(view),
      ...buildLockedQueueControls(view.guildId, view.version, secret),
    ],
  };
}

function buildThumbnailAttachment(): AttachmentBuilder {
  return new AttachmentBuilder(readFileSync(THUMBNAIL_ASSET_PATH), {
    name: THUMBNAIL_FILE_NAME,
  });
}

function buildHeaderSection(): SectionBuilder {
  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('# Match Queue'),
      new TextDisplayBuilder().setContent('Private 5v5 CS2 matchmaking.'),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${THUMBNAIL_FILE_NAME}`));
}

function buildSummaryContainer(view: QueuePanelView): ContainerBuilder {
  const playersNeeded = Math.max(0, view.queueCapacity - view.queueCount);
  const queueMetric =
    view.queueCount >= view.queueCapacity
      ? `## ${String(view.queueCount)} / ${String(view.queueCapacity)} players\nReady check starting`
      : `## ${String(view.queueCount)} / ${String(view.queueCapacity)} players\nWaiting for **${playersNeededLabel(playersNeeded)}**`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(buildHeaderSection())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(queueMetric),
      new TextDisplayBuilder().setContent(`**Next**\n${LIFECYCLE}`),
    );
}

function buildRosterContainer(view: QueuePanelView): ContainerBuilder {
  const heading =
    view.queueCount === 0
      ? '## Players in Queue'
      : `## Players in Queue · ${String(view.queueCount)}`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(heading),
      new TextDisplayBuilder().setContent(formatRoster(view.playerDisplayNames)),
    );
}

function buildLockedSummaryContainer(view: QueuePanelView): ContainerBuilder {
  const phase = view.activeMatchState;
  let heading: string;
  let subtext: string;

  if (phase === null || phase === undefined) {
    heading = '## Queue unavailable';
    subtext = 'A match is currently being formed.';
  } else if (phase === 'FINISHED' || phase === 'CANCELED' || phase === 'FAILED') {
    heading = '## Queue reopening';
    subtext = 'Cleanup is finishing before the next queue opens.';
  } else {
    heading = '## Match in progress';
    subtext = 'The queue will reopen when the match finishes.';
  }

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(buildHeaderSection())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${heading}\n${subtext}`));
}

function formatRoster(names: string[]): string {
  if (names.length === 0) return 'No players queued.';
  const lines: string[] = [];
  let used = 0;
  for (const [index, raw] of names.entries()) {
    const name = raw.length > NAME_LIMIT ? `${raw.slice(0, NAME_LIMIT - 1)}…` : raw;
    const line = `\`${String(index + 1).padStart(2, '0')}\` ${name}`;
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
