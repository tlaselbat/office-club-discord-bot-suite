import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createMatchCustomId } from './match-custom-id.js';
import { createQueueCustomId } from './queue-custom-id.js';
import { createPlayerHubCustomId } from './player-hub-custom-id.js';
import { createSteamAccountCustomId } from './steam-account-custom-id.js';

const PANEL_ACTOR_PLACEHOLDER = '00000000000000000000';

export interface ReadyCheckControl {
  matchId: string;
  version: number;
  phaseGeneration: number;
}

export function joinQueueButton(
  guildId: string,
  version: number,
  secret: string,
  label = 'Join Queue',
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'JOIN', guildId, version }, secret))
    .setLabel(label)
    .setStyle(ButtonStyle.Success);
}

export function leaveQueueButton(guildId: string, version: number, secret: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'LEAVE', guildId, version }, secret))
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Danger);
}

export function matchCenterButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
  label = 'Match Center',
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createPlayerHubCustomId({ action: 'HUB', guildId, actorDiscordUserId }, secret))
    .setLabel(label)
    .setStyle(ButtonStyle.Primary);
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
    .setStyle(ButtonStyle.Secondary);
}

export function howItWorksButton(guildId: string, version: number, secret: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'HOW_IT_WORKS', guildId, version }, secret))
    .setLabel('How It Works')
    .setStyle(ButtonStyle.Secondary);
}

export function queueRefreshButton(
  guildId: string,
  version: number,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createQueueCustomId({ action: 'REFRESH', guildId, version }, secret))
    .setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary);
}

function readyButton(secret: string, readyCheck?: ReadyCheckControl): ButtonBuilder {
  if (readyCheck === undefined) {
    return new ButtonBuilder()
      .setCustomId('tmq:ready-unavailable')
      .setLabel('Ready')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);
  }
  return new ButtonBuilder()
    .setCustomId(createMatchCustomId({ action: 'READY', ...readyCheck }, secret))
    .setLabel('Ready')
    .setStyle(ButtonStyle.Success);
}

export function buildQueueControls(
  guildId: string,
  version: number,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      joinQueueButton(guildId, version, secret),
      readyButton(secret),
      matchCenterButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      steamAccountButton(guildId, secret),
      howItWorksButton(guildId, version, secret),
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
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      matchCenterButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      steamAccountButton(guildId, secret),
      howItWorksButton(guildId, version, secret),
      queueRefreshButton(guildId, version, secret),
    ),
  ];
}
