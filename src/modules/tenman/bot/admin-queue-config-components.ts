import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import {
  createAdminQueueConfigCustomId,
  type AdminQueueConfigPayload,
} from './admin-queue-config-custom-id.js';

const teamLabel = { C: 'Captains', S: 'Scramble' } as const;
const mapLabel = { V: 'Captain Veto', R: 'Random Map' } as const;
const locationLabel = { D: 'Central — Dallas', L: 'West — Los Angeles', V: 'East — Virginia' } as const;

/** Ephemeral configuration draft. Save is the only persistent operation. */
export function buildAdminQueueConfiguration(
  payload: Omit<AdminQueueConfigPayload, 'action'>,
  secret: string,
) {
  const customId = (action: AdminQueueConfigPayload['action']) =>
    createAdminQueueConfigCustomId({ ...payload, action }, secret);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Configure Match Queue')
        .setColor(0x5865f2)
        .setDescription('Changes apply to future queues after you save this review.')
        .addFields(
          { name: 'Game Profile', value: 'Competitive — BO1 5v5 (10 players, 11 slots)', inline: false },
          { name: 'Team Selection', value: teamLabel[payload.team], inline: true },
          { name: 'Map Selection', value: mapLabel[payload.map], inline: true },
          { name: 'Location', value: locationLabel[payload.location], inline: true },
        )
        .setFooter({ text: `Reviewing configuration version ${String(payload.settingsVersion)}` }),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId('TEAM'))
          .setPlaceholder('Team selection')
          .addOptions(
            { label: 'Captains', value: 'C', default: payload.team === 'C' },
            { label: 'Scramble', value: 'S', default: payload.team === 'S' },
          ),
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId('MAP'))
          .setPlaceholder('Map selection')
          .addOptions(
            { label: 'Captain Veto', value: 'V', default: payload.map === 'V' },
            { label: 'Random Map', value: 'R', default: payload.map === 'R' },
          ),
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId('LOCATION'))
          .setPlaceholder('Server location')
          .addOptions(
            { label: 'Central — Dallas', value: 'D', default: payload.location === 'D' },
            { label: 'West — Los Angeles', value: 'L', default: payload.location === 'L' },
            { label: 'East — Virginia', value: 'V', default: payload.location === 'V' },
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId('SAVE')).setLabel('Save Configuration').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(customId('CANCEL')).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function configurationDraftFromSettings(settings: {
  version: number;
  teamSelectionMode: string;
  mapSelectionMode: string;
  defaultServerLocation: string | null;
}) {
  return {
    settingsVersion: settings.version,
    team: settings.teamSelectionMode === 'RANDOM' ? ('S' as const) : ('C' as const),
    map: settings.mapSelectionMode === 'RANDOM' ? ('R' as const) : ('V' as const),
    location:
      settings.defaultServerLocation === 'los_angeles'
        ? ('L' as const)
        : settings.defaultServerLocation === 'virginia'
          ? ('V' as const)
          : ('D' as const),
  };
}
