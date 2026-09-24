import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createQueueCustomId } from './queue-custom-id.js';
import { createPlayerHubCustomId } from './player-hub-custom-id.js';
import { createSteamAccountCustomId } from './steam-account-custom-id.js';

export function buildQueueControls(
  guildId: string,
  version: number,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createQueueCustomId({ action: 'JOIN', guildId, version }, secret))
        .setLabel('Join Queue')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          createPlayerHubCustomId(
            { action: 'HUB', guildId, actorDiscordUserId: '00000000000000000000' },
            secret,
          ),
        )
        .setLabel('My 10man')
        .setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          createSteamAccountCustomId(
            { action: 'OPEN', guildId, actorDiscordUserId: '00000000000000000000' },
            secret,
          ),
        )
        .setLabel('Steam Account')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(createQueueCustomId({ action: 'HOW_IT_WORKS', guildId, version }, secret))
        .setLabel('How It Works')
        .setStyle(ButtonStyle.Secondary),
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
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          createPlayerHubCustomId(
            { action: 'HUB', guildId, actorDiscordUserId: '00000000000000000000' },
            secret,
          ),
        )
        .setLabel('My 10man')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}
