import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from 'discord.js';
import { createQueueCustomId } from './queue-custom-id.js';

export function buildQueueControls(
  guildId: string,
  version: number,
  secret: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(createQueueCustomId({ action: 'JOIN', guildId, version }, secret))
          .setLabel('Join Queue')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(createQueueCustomId({ action: 'LEAVE', guildId, version }, secret))
          .setLabel('Leave Queue')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}
