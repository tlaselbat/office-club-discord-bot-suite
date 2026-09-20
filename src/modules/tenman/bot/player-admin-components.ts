import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createPlayerAdminCustomId,
  type PlayerAdminComponentPayload,
} from './player-admin-custom-id.js';

export function buildPlayerStatsResetConfirmationControls(
  payload: Omit<PlayerAdminComponentPayload, 'action'>,
  secret: string,
) {
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(createPlayerAdminCustomId({ ...payload, action: 'RS' }, secret))
          .setLabel('Confirm statistics reset')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(createPlayerAdminCustomId({ ...payload, action: 'RC' }, secret))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}
