import { ActionRowBuilder, EmbedBuilder, UserSelectMenuBuilder } from 'discord.js';
import { createMatchModeratorCustomId } from './match-moderator-custom-id.js';
export function buildMatchModeratorPanel(
  guildId: string,
  members: Array<{ discordUserId: string; status: string }>,
  secret: string,
) {
  const id = (action: 'ADD' | 'REMOVE') =>
    createMatchModeratorCustomId({ action, guildId }, secret);
  const list = members.length
    ? members
        .map(
          (m) => `• <@${m.discordUserId}> — ${m.status === 'ACTIVE' ? 'Active' : 'Steam invalid'}`,
        )
        .join('\n')
    : 'No Match Moderators configured.';
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Match Moderators')
        .setColor(0x5865f2)
        .setDescription(list.slice(0, 4096))
        .setFooter({ text: 'Added moderators need an active Steam account.' }),
    ],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(id('ADD'))
          .setPlaceholder('Add Match Moderator')
          .setMaxValues(1),
      ),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(id('REMOVE'))
          .setPlaceholder('Remove Match Moderator')
          .setMaxValues(1),
      ),
    ],
  };
}
