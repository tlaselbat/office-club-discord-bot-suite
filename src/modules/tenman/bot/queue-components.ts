import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createMatchCustomId } from './match-custom-id.js';
import { createPartyCustomId } from './party-custom-id.js';
import { createPlayerHubCustomId } from './player-hub-custom-id.js';
import { createQueueCustomId } from './queue-custom-id.js';
import { createSteamAccountCustomId } from './steam-account-custom-id.js';

const PANEL_ACTOR_PLACEHOLDER = '00000000000000000000';
// Discord supplies semantic button colors rather than arbitrary CSS colors. These map
// cleanly onto the navy/orange CS2 panel artwork without introducing Discord blurple:
// green for player actions, slate for reference/navigation, and red for a locked queue.
const PLAYER_ACTION_STYLE = ButtonStyle.Success;
const NAVIGATION_STYLE = ButtonStyle.Secondary;
const LOCKED_QUEUE_STYLE = ButtonStyle.Danger;

export interface ReadyCheckControl {
  matchId: string;
  version: number;
  phaseGeneration: number;
}

export function joinLeaveQueueButton(
  guildId: string,
  version: number,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'TOGGLE', guildId, version }, secret))
    .setLabel('Join / Leave Queue')
    .setStyle(PLAYER_ACTION_STYLE);
}

export function matchHistoryButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      createPlayerHubCustomId({ action: 'HISTORY', guildId, actorDiscordUserId }, secret),
    )
    .setLabel('Match History')
    .setStyle(NAVIGATION_STYLE);
}

export function statsButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createPlayerHubCustomId({ action: 'STATS', guildId, actorDiscordUserId }, secret))
    .setLabel('Stats')
    .setStyle(NAVIGATION_STYLE);
}

export function teamStatusButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createPartyCustomId({ action: 'PANEL', guildId, actorDiscordUserId }, secret))
    .setLabel('Team Status')
    .setStyle(PLAYER_ACTION_STYLE);
}

export function steamAccountButton(guildId: string, secret: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      createSteamAccountCustomId(
        { action: 'VIEW', guildId, actorDiscordUserId: PANEL_ACTOR_PLACEHOLDER },
        secret,
      ),
    )
    .setLabel('Steam Account')
    .setStyle(NAVIGATION_STYLE);
}

export function howItWorksButton(guildId: string, version: number, secret: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'HOW_IT_WORKS', guildId, version }, secret))
    .setLabel('How It Works')
    .setStyle(NAVIGATION_STYLE);
}

export function queueRefreshButton(
  guildId: string,
  version: number,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'REFRESH', guildId, version }, secret))
    .setLabel('Refresh')
    .setStyle(NAVIGATION_STYLE);
}

function readyButton(secret: string, readyCheck?: ReadyCheckControl): ButtonBuilder {
  if (readyCheck === undefined) {
    return new ButtonBuilder()
      .setCustomId('tmq:ready-unavailable')
      .setLabel('Ready')
      .setStyle(PLAYER_ACTION_STYLE)
      .setDisabled(true);
  }
  return new ButtonBuilder()
    .setCustomId(createMatchCustomId({ action: 'READY', ...readyCheck }, secret))
    .setLabel('Ready')
    .setStyle(PLAYER_ACTION_STYLE);
}

export function buildQueueControls(
  guildId: string,
  version: number,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      joinLeaveQueueButton(guildId, version, secret),
      readyButton(secret),
      matchHistoryButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
      statsButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      steamAccountButton(guildId, secret),
      howItWorksButton(guildId, version, secret),
      teamStatusButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
      queueRefreshButton(guildId, version, secret),
    ),
  ];
}

export function buildLockedQueueControls(
  guildId: string,
  version: number,
  secret: string,
  readyCheck?: ReadyCheckControl,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      readyButton(secret, readyCheck),
      new ButtonBuilder()
        // Discord requires every component custom ID in a message to be unique,
        // including disabled controls. The usable Refresh button below owns the
        // signed REFRESH ID.
        .setCustomId('tmq:queue-locked')
        .setLabel('Queue Locked')
        .setStyle(LOCKED_QUEUE_STYLE)
        .setDisabled(true),
      matchHistoryButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
      statsButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      steamAccountButton(guildId, secret),
      howItWorksButton(guildId, version, secret),
      teamStatusButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
      queueRefreshButton(guildId, version, secret),
    ),
  ];
}
