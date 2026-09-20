import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createMatchAdminCustomId,
  type MatchAdminComponentPayload,
} from './match-admin-custom-id.js';

export function buildRollbackConfirmationControls(
  payload: Omit<MatchAdminComponentPayload, 'action'>,
  secret: string,
) {
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(createMatchAdminCustomId({ ...payload, action: 'RB' }, secret))
          .setLabel('Confirm rating rollback')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(createMatchAdminCustomId({ ...payload, action: 'RX' }, secret))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}

export function buildRestartPhaseConfirmationControls(
  payload: Omit<MatchAdminComponentPayload, 'action'>,
  secret: string,
) {
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(createMatchAdminCustomId({ ...payload, action: 'RP' }, secret))
          .setLabel('Restart current phase')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(createMatchAdminCustomId({ ...payload, action: 'RC' }, secret))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}

export function buildCancelMatchConfirmationControls(
  payload: Omit<MatchAdminComponentPayload, 'action'>,
  secret: string,
) {
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(createMatchAdminCustomId({ ...payload, action: 'CA' }, secret))
          .setLabel('Confirm match cancellation')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(createMatchAdminCustomId({ ...payload, action: 'CC' }, secret))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}
