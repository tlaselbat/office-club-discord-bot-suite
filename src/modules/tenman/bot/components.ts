import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from 'discord.js';
import type { MatchState } from '../domain/match-state.js';
import { createCustomId } from './custom-id.js';

export interface MatchControlsInput {
  matchId: string;
  version: number;
  state: MatchState;
  allowedMaps: readonly string[];
  allowedProfiles: readonly { key: string; label: string }[];
  secret: string;
}

export function buildMatchControls(
  input: MatchControlsInput,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const id = (action: string): string =>
    createCustomId({ action, matchId: input.matchId, version: input.version }, input.secret);
  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];
  if (input.state === 'OPEN') {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(id('JOIN'))
            .setLabel('Join')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(id('LEAVE'))
            .setLabel('Leave')
            .setStyle(ButtonStyle.Secondary),
        )
        .toJSON(),
    );
  }
  if (['OPEN', 'FULL', 'TEAM_SETUP'].includes(input.state)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(id('READY'))
            .setLabel('Ready')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(id('UNREADY'))
            .setLabel('Unready')
            .setStyle(ButtonStyle.Secondary),
        )
        .toJSON(),
    );
  }
  if (input.state === 'FULL' || input.state === 'TEAM_SETUP') {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(id('RANDOMIZE_TEAMS'))
            .setLabel('Randomize Teams')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(id('LOCK_TEAMS'))
            .setLabel('Lock Teams')
            .setStyle(ButtonStyle.Danger),
        )
        .toJSON(),
    );
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(id('SELECT_MAP'))
            .setPlaceholder('Select map')
            .addOptions(input.allowedMaps.slice(0, 25).map((map) => ({ label: map, value: map }))),
        )
        .toJSON(),
    );
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(id('SELECT_PROFILE'))
            .setPlaceholder('Select game profile')
            .addOptions(
              input.allowedProfiles.slice(0, 25).map((profile) => ({
                label: profile.label,
                value: profile.key,
              })),
            ),
        )
        .toJSON(),
    );
    rows.push(
      new ActionRowBuilder<UserSelectMenuBuilder>()
        .addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(id('SELECT_TEAM_PARTICIPANT'))
            .setPlaceholder('Choose participant to assign')
            .setMinValues(1)
            .setMaxValues(1),
        )
        .toJSON(),
    );
  }

  if (['SERVER_READY', 'MATCH_LOADED', 'WARMUP', 'LIVE', 'PAUSED'].includes(input.state)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(id('GET_CONNECT_INFO'))
            .setLabel('Get Connect Info')
            .setStyle(ButtonStyle.Secondary),
        )
        .toJSON(),
    );
  }

  if (input.state === 'MATCH_LOADED' || input.state === 'WARMUP') {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(id('FORCE_START'))
            .setLabel('Force Start')
            .setStyle(ButtonStyle.Primary),
        )
        .toJSON(),
    );
  }

  if (input.state === 'LIVE' || input.state === 'PAUSED') {
    const pauseResume =
      input.state === 'LIVE'
        ? new ButtonBuilder()
            .setCustomId(id('PAUSE'))
            .setLabel('Pause')
            .setStyle(ButtonStyle.Danger)
        : new ButtonBuilder()
            .setCustomId(id('RESUME'))
            .setLabel('Resume')
            .setStyle(ButtonStyle.Success);
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          pauseResume,
          new ButtonBuilder()
            .setCustomId(id('FORCE_END'))
            .setLabel('Force End')
            .setStyle(ButtonStyle.Danger),
        )
        .toJSON(),
    );
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(id('RESTORE_ROUND'))
            .setPlaceholder('Restore round')
            .addOptions(
              Array.from({ length: 25 }, (_, index) => {
                const round = String(index + 1);
                return { label: `Round ${round}`, value: round };
              }),
            ),
        )
        .toJSON(),
    );
  }

  return rows;
}

export function buildTeamChoiceControls(
  matchId: string,
  version: number,
  targetDiscordUserId: string,
  secret: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const id = (action: string): string =>
    createCustomId({ action, matchId, version, targetDiscordUserId }, secret);
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(id('ASSIGN_TEAM_1'))
          .setLabel('Team 1')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(id('ASSIGN_TEAM_2'))
          .setLabel('Team 2')
          .setStyle(ButtonStyle.Primary),
      )
      .toJSON(),
  ];
}
