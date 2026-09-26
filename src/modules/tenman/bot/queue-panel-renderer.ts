import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AttachmentBuilder,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import {
  buildLockedQueueControls,
  buildQueueControls,
  type ReadyCheckControl,
} from './queue-components.js';
import { playersNeededLabel } from './presentation.js';

const ACCENT_COLOR = 0x5865f2;
const TEXT_DISPLAY_LIMIT = 4000;
const NAME_LIMIT = 48;
// Discord Components V2 does not expose a width property. A non-breaking-space suffix
// is the only client-rendered width hint available to a TextDisplay. Keep this shared
// target on meaningful existing lines so the summary and roster request the same
// desktop footprint without adding dummy components or media.
const PANEL_WIDTH_TARGET = 96;
const WIDTH_SPACER_CHARACTER = '\u00a0';
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
  /** Ready-check identifiers are present only while the full lobby is awaiting confirmation. */
  readyCheck?: ReadyCheckControl;
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
      ...buildLockedQueueControls(view.guildId, view.version, secret, view.readyCheck),
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
      new TextDisplayBuilder().setContent('## Match Queue'),
      new TextDisplayBuilder().setContent(
        '-# Private 5v5 CS2 matchmaking for competitive, balanced games with your friends.',
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${THUMBNAIL_FILE_NAME}`));
}

function buildContentSeparator(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function addPanelWidthSpacer(content: string): string {
  return content
    .split('\n')
    .map(
      (line) =>
        `${line}${WIDTH_SPACER_CHARACTER.repeat(Math.max(0, PANEL_WIDTH_TARGET - line.length))}`,
    )
    .join('\n');
}

function buildSummaryContainer(view: QueuePanelView): ContainerBuilder {
  const playersNeeded = Math.max(0, view.queueCapacity - view.queueCount);
  const queueMetric =
    view.queueCount >= view.queueCapacity
      ? `**${String(view.queueCount)} / ${String(view.queueCapacity)} players**\n-# Ready check starting`
      : `**${String(view.queueCount)} / ${String(view.queueCapacity)} players**\n-# Waiting for ${playersNeededLabel(playersNeeded)}`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(buildHeaderSection())
    .addSeparatorComponents(buildContentSeparator())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(addPanelWidthSpacer(queueMetric)))
    .addSeparatorComponents(buildContentSeparator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        addPanelWidthSpacer(
          `**Next**\nReady Check when the queue reaches ${String(view.queueCapacity)}`,
        ),
      ),
    );
}

function buildRosterContainer(view: QueuePanelView): ContainerBuilder {
  const heading = addPanelWidthSpacer(`**Queued Players · ${String(view.queueCount)}**`);

  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
    .addSeparatorComponents(buildContentSeparator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(formatRoster(view.playerDisplayNames)),
    );
}

function buildLockedSummaryContainer(view: QueuePanelView): ContainerBuilder {
  const phase = view.activeMatchState;
  let heading: string;
  let subtext: string;

  if (phase === null || phase === undefined) {
    heading = '**Queue unavailable**';
    subtext = 'A match is currently being formed.';
  } else if (phase === 'FINISHED' || phase === 'CANCELED' || phase === 'FAILED') {
    heading = '**Queue reopening**';
    subtext = 'Cleanup is finishing before the next queue opens.';
  } else {
    heading = '**Match in progress**';
    subtext = 'The queue will reopen when the match finishes.';
  }

  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addSectionComponents(buildHeaderSection())
    .addSeparatorComponents(buildContentSeparator())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${heading}\n-# ${subtext}`));
}

function formatRoster(names: string[]): string {
  if (names.length === 0) return '-# No players queued.';
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
