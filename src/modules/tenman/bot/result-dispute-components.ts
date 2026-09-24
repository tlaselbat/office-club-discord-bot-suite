import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export function buildResultDisputeModal(modalCustomId: string): ModalBuilder {
  return (
    new ModalBuilder()
      .setCustomId(modalCustomId)
      .setTitle('Report Match Result Issue')
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('dispute_reason')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('What is wrong with the result?')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(5)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      )
  );
}

export function buildResultDisputeAcknowledgedResponse(disputeId: string): string {
  return `Your result dispute was submitted as \`${disputeId.slice(0, 8)}\`. Staff will review it.`;
}
