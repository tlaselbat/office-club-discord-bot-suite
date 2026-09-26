import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { paginateMapPool, type ActiveMapPool } from '../services/map-pool-service.js';
import { createMapPoolCustomId, type MapPoolComponentPayload } from './map-pool-custom-id.js';

export interface MapPoolManagementView {
  guildId: string;
  actorDiscordUserId: string;
  settingsVersion: number;
  activePool: ActiveMapPool;
  officialMaps: string[];
  workshopMaps: Array<{ mapName: string; displayName: string }>;
  page: number;
}

export function buildMapPoolManagement(view: MapPoolManagementView, secret: string) {
  const candidates = [
    ...view.officialMaps.map((mapName) => ({
      mapName,
      label: mapName,
      description: 'Official CS2 map',
    })),
    ...view.workshopMaps.map((map) => ({
      mapName: map.mapName,
      label: map.displayName,
      description: `Workshop: ${map.mapName}`,
    })),
  ];
  const page = paginateMapPool(candidates, view.page);
  const expiresAt = Math.floor(Date.now() / 1000) + 900;
  const id = (action: MapPoolComponentPayload['action'], pageNumber = page.page) =>
    createMapPoolCustomId(
      {
        action,
        guildId: view.guildId,
        actorDiscordUserId: view.actorDiscordUserId,
        settingsVersion: view.settingsVersion,
        page: Math.max(0, pageNumber),
        expiresAt,
      },
      secret,
    );
  const active = new Set(view.activePool.mapNames);
  const pageWorkshopMaps = page.items.filter((candidate) =>
    candidate.mapName.startsWith('workshop/'),
  );
  const hasPoolCandidates = page.items.length > 0;
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Map Source and Pool')
        .setColor(0x5865f2)
        .setDescription(
          `Active pool (${view.activePool.source === 'PROFILE_DEFAULT' ? 'profile default' : 'guild saved'}):\n` +
            (view.activePool.mapNames.length
              ? view.activePool.mapNames
                  .map((mapName) => `• \`${mapName}\``)
                  .join('\n')
                  .slice(0, 3000)
              : 'No maps configured.'),
        )
        .addFields({
          name: 'Workshop Catalog',
          value: `${String(view.workshopMaps.length)} configured map${view.workshopMaps.length === 1 ? '' : 's'}`,
          inline: true,
        })
        .setFooter({
          text: `Map page ${String(page.page + 1)} of ${String(page.pageCount)} · changes apply to future matches`,
        }),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(id('POOL'))
          .setPlaceholder('Choose active pool maps on this page')
          .setMinValues(0)
          .setMaxValues(hasPoolCandidates ? page.items.length : 1)
          .setDisabled(!hasPoolCandidates)
          .addOptions(
            hasPoolCandidates
              ? page.items.map((candidate) => ({
                  label: candidate.label.slice(0, 100),
                  value: candidate.mapName,
                  description: candidate.description.slice(0, 100),
                  default: active.has(candidate.mapName),
                }))
              : [{ label: 'No maps available', value: 'none' }],
          ),
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(id('REMOVE'))
          .setPlaceholder('Remove a Workshop map from the catalog')
          .setDisabled(pageWorkshopMaps.length === 0)
          .addOptions(
            pageWorkshopMaps.length
              ? pageWorkshopMaps.map((candidate) => ({
                  label: candidate.label.slice(0, 100),
                  value: candidate.mapName,
                  description: candidate.mapName.slice(0, 100),
                }))
              : [{ label: 'No Workshop map on this page', value: 'none' }],
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(id('ADD'))
          .setLabel('Add Workshop Map')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(id('PREVIOUS', page.page - 1))
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!page.hasPreviousPage),
        new ButtonBuilder()
          .setCustomId(id('NEXT', page.page + 1))
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!page.hasNextPage),
      ),
    ],
  };
}
