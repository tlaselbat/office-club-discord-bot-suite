import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createAdminCustomId, type AdminComponentPayload } from './admin-custom-id.js';

export function buildAdminConfirmationControls(
  payload: Omit<AdminComponentPayload, 'action'>,
  secret: string,
  kind: 'teardown' | 'recovery',
) {
  const confirmAction = kind === 'teardown' ? 'TC' : 'RA';
  const cancelAction = kind === 'teardown' ? 'TX' : 'RX';
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(createAdminCustomId({ ...payload, action: confirmAction }, secret))
          .setLabel(kind === 'teardown' ? 'Confirm archive and lock' : 'Acknowledge manual cleanup')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(createAdminCustomId({ ...payload, action: cancelAction }, secret))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}
