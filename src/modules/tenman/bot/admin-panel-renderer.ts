import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { createAdminPanelCustomId } from './admin-panel-custom-id.js';

export interface AdminPanelView {
  guildId: string;
  settingsVersion: number;
  queueVersion: number;
  enabled: boolean;
  queueStatus: 'OPEN' | 'LOCKED' | 'DISABLED' | 'NOT_STARTED';
  queueCount: number;
  queueCapacity: number;
  profile: string | null;
  location: string | null;
  matchModeratorCount: number;
}

export function renderAdminPanel(view: AdminPanelView, secret: string) {
  const operational = view.enabled && view.profile !== null;
  const status =
    view.queueStatus === 'OPEN'
      ? 'Open — players may join'
      : view.queueStatus === 'LOCKED'
        ? 'Locked — match in progress'
        : view.queueStatus === 'NOT_STARTED'
          ? 'Not started'
          : 'Closed';
  const id = (
    action: 'CONFIGURE' | 'MODERATORS' | 'MAPS' | 'OPEN' | 'CLOSE' | 'REPAIR' | 'REFRESH',
  ) =>
    createAdminPanelCustomId({ action, guildId: view.guildId, version: view.queueVersion }, secret);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Match Queue Control')
        .setColor(view.queueStatus === 'OPEN' ? 0x57f287 : 0x5865f2)
        .setDescription(
          operational
            ? 'Configure the installation with recovery commands; operate player enrollment here.'
            : 'Competitive configuration is incomplete. Complete configuration before opening enrollment.',
        )
        .addFields(
          { name: 'Enrollment', value: status, inline: true },
          {
            name: 'Queue',
            value: `${String(view.queueCount)} / ${String(view.queueCapacity)} players`,
            inline: true,
          },
          { name: 'Match Moderators', value: String(view.matchModeratorCount), inline: true },
          { name: 'Profile', value: view.profile ?? 'Not configured', inline: true },
          { name: 'Location', value: view.location ?? 'Dallas', inline: true },
        )
        .setFooter({ text: `Configuration version ${String(view.settingsVersion)}` }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(id('CONFIGURE'))
          .setLabel('Configure Queue')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(id('MODERATORS'))
          .setLabel('Match Moderators')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(id('MAPS'))
          .setLabel('Maps')
          .setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(id('OPEN'))
          .setLabel('Open Queue')
          .setStyle(ButtonStyle.Success)
          .setDisabled(
            !operational || view.queueStatus === 'OPEN' || view.queueStatus === 'LOCKED',
          ),
        new ButtonBuilder()
          .setCustomId(id('CLOSE'))
          .setLabel('Close Queue')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(view.queueStatus !== 'OPEN'),
        new ButtonBuilder()
          .setCustomId(id('REPAIR'))
          .setLabel('Repair Queue Panel')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(id('REFRESH'))
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
