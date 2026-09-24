import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createQueueCustomId } from './queue-custom-id.js';
import { createPlayerHubCustomId } from './player-hub-custom-id.js';
import { createSteamAccountCustomId } from './steam-account-custom-id.js';

const PANEL_ACTOR_PLACEHOLDER = '00000000000000000000';

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

export function myTenManButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
  label = 'Lobby Status',
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

export function buildQueueControls(
  guildId: string,
  version: number,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      joinQueueButton(guildId, version, secret),
      myTenManButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
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
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createQueueCustomId({ action: 'REFRESH', guildId, version }, secret))
        .setLabel('Queue Locked')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      myTenManButton(guildId, PANEL_ACTOR_PLACEHOLDER, secret),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      steamAccountButton(guildId, secret),
      howItWorksButton(guildId, version, secret),
      queueRefreshButton(guildId, version, secret),
    ),
  ];
}
