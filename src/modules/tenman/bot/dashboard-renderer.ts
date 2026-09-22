import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from 'discord.js';
import { createMatchCustomId } from './match-custom-id.js';

export interface MatchDashboardView {
  matchId: string;
  state: string;
  version: number;
  phaseGeneration: number;
  phaseDeadlineAt: Date | null;
  readyDiscordUserIds: readonly string[];
  players: readonly MatchDashboardPlayer[];
  selectedMap: string | null;
  draftPickCount: number;
  vetoedMaps: readonly string[];
  allowedMaps: readonly string[];
  teamSelectionMode: string;
  captainPolicy: string;
  mapSelectionMode: string;
  score: { team1: number; team2: number } | null;
}

export interface MatchDashboardPlayer {
  discordUserId: string;
  displayName: string;
  team: 'UNASSIGNED' | 'TEAM_1' | 'TEAM_2' | 'SPECTATOR';
  captainTeam: 'TEAM_1' | 'TEAM_2' | null;
}

export function renderMatchDashboard(
  view: MatchDashboardView,
  secret: string,
): { embeds: object[]; components: APIActionRowComponent<APIComponentInMessageActionRow>[] } {
  const remaining =
    view.phaseDeadlineAt === null
      ? '—'
      : `<t:${String(Math.floor(view.phaseDeadlineAt.getTime() / 1000))}:R>`;
  const base = {
    title: `MATCH ${view.matchId.slice(0, 8)}`,
    description: `State: **${view.state}**`,
    fields: [
      { name: 'Players', value: renderRosters(view.players) },
      { name: 'Map', value: view.selectedMap ?? 'Pending', inline: true },
      { name: 'Deadline', value: remaining, inline: true },
      {
        name: 'Score',
        value:
          view.score === null
            ? 'Score pending'
            : `Team 1 ${String(view.score.team1)} — ${String(view.score.team2)} Team 2`,
        inline: true,
      },
    ],
  };
  if (view.state === 'TEAM_SELECTION') return renderDraft(view, secret, base);
  if (view.state === 'MAP_VETO') return renderVeto(view, secret, base);
  if (view.state !== 'READY_CHECK')
    return { embeds: [base], components: matchInfoControls(view, secret) };
  const ready = new Set(view.readyDiscordUserIds);
  const players = view.players
    .map((player) => `${ready.has(player.discordUserId) ? '✅' : '❌'} ${player.displayName}`)
    .join('\n');
  return {
    embeds: [
      {
        ...base,
        description: `READY CHECK — ${String(ready.size)} / ${String(view.players.length)}`,
        fields: [{ name: 'Players', value: players || 'None' }, ...base.fields.slice(1)],
      },
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              createMatchCustomId(
                {
                  action: 'READY',
                  matchId: view.matchId,
                  version: view.version,
                  phaseGeneration: view.phaseGeneration,
                },
                secret,
              ),
            )
            .setLabel('Ready')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(
              createMatchCustomId(
                {
                  action: 'WITHDRAW_READY',
                  matchId: view.matchId,
                  version: view.version,
                  phaseGeneration: view.phaseGeneration,
                },
                secret,
              ),
            )
            .setLabel('Withdraw')
            .setStyle(ButtonStyle.Secondary),
        )
        .toJSON(),
      ...matchInfoControls(view, secret),
    ],
  };
}

function renderDraft(
  view: MatchDashboardView,
  secret: string,
  base: {
    title: string;
    description: string;
    fields: { name: string; value: string; inline?: boolean }[];
  },
): { embeds: object[]; components: APIActionRowComponent<APIComponentInMessageActionRow>[] } {
  if (view.teamSelectionMode !== 'CAPTAINS' || view.captainPolicy !== 'RANDOM') {
    return {
      embeds: [{ ...base, description: 'TEAM SELECTION — configured policy is unsupported.' }],
      components: [],
    };
  }
  const captains = view.players.filter((player) => player.captainTeam !== null);
  if (captains.length !== 2) {
    return {
      embeds: [
        {
          ...base,
          description: 'TEAM SELECTION — awaiting a moderator or match leader to select captains.',
        },
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                createMatchCustomId(
                  {
                    action: 'SELECT_RANDOM_CAPTAINS',
                    matchId: view.matchId,
                    version: view.version,
                    phaseGeneration: view.phaseGeneration,
                  },
                  secret,
                ),
              )
              .setLabel('Select random captains')
              .setStyle(ButtonStyle.Primary),
          )
          .toJSON(),
      ],
    };
  }
  const nextTeam = ['TEAM_1', 'TEAM_2', 'TEAM_2', 'TEAM_1', 'TEAM_1', 'TEAM_2', 'TEAM_2', 'TEAM_1'][
    view.draftPickCount
  ];
  const captain = captains.find((player) => player.captainTeam === nextTeam);
  const available = view.players.filter((player) => player.team === 'UNASSIGNED');
  if (captain === undefined || available.length === 0) return { embeds: [base], components: [] };
  return {
    embeds: [
      {
        ...base,
        description: `TEAM SELECTION — <@${captain.discordUserId}> picks for **${nextTeam === 'TEAM_1' ? 'Team 1' : 'Team 2'}**.`,
        fields: [
          ...base.fields,
          {
            name: 'Captains',
            value: captains
              .map(
                (player) =>
                  `${player.captainTeam === 'TEAM_1' ? 'Team 1' : 'Team 2'}: <@${player.discordUserId}>`,
              )
              .join('\n'),
          },
        ],
      },
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createMatchCustomId(
                {
                  action: 'DRAFT_PICK',
                  matchId: view.matchId,
                  version: view.version,
                  phaseGeneration: view.phaseGeneration,
                  targetDiscordUserId: captain.discordUserId,
                },
                secret,
              ),
            )
            .setPlaceholder('Choose a player')
            .addOptions(
              available.map((player) => ({
                label: player.displayName.slice(0, 100),
                value: player.discordUserId,
              })),
            ),
        )
        .toJSON(),
    ],
  };
}

function renderVeto(
  view: MatchDashboardView,
  secret: string,
  base: {
    title: string;
    description: string;
    fields: { name: string; value: string; inline?: boolean }[];
  },
): { embeds: object[]; components: APIActionRowComponent<APIComponentInMessageActionRow>[] } {
  if (view.mapSelectionMode !== 'CAPTAIN_VETO') {
    return {
      embeds: [{ ...base, description: 'MAP VETO — configured policy is unsupported.' }],
      components: [],
    };
  }
  const nextTeam = view.vetoedMaps.length % 2 === 0 ? 'TEAM_1' : 'TEAM_2';
  const captain = view.players.find((player) => player.captainTeam === nextTeam);
  const maps = view.allowedMaps.filter((map) => !view.vetoedMaps.includes(map));
  if (captain === undefined || maps.length < 2) return { embeds: [base], components: [] };
  return {
    embeds: [
      {
        ...base,
        description: `MAP VETO — <@${captain.discordUserId}> bans a map for **${nextTeam === 'TEAM_1' ? 'Team 1' : 'Team 2'}**.`,
        fields: [
          ...base.fields,
          { name: 'Banned maps', value: view.vetoedMaps.join(', ') || 'None' },
        ],
      },
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              createMatchCustomId(
                {
                  action: 'VETO_BAN',
                  matchId: view.matchId,
                  version: view.version,
                  phaseGeneration: view.phaseGeneration,
                  targetDiscordUserId: captain.discordUserId,
                },
                secret,
              ),
            )
            .setPlaceholder('Ban a map')
            .addOptions(maps.slice(0, 25).map((map) => ({ label: map.slice(0, 100), value: map }))),
        )
        .toJSON(),
    ],
  };
}

function matchInfoControls(
  view: MatchDashboardView,
  secret: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  if (!['SERVER_READY', 'MATCH_LOADED', 'WARMUP', 'LIVE', 'PAUSED'].includes(view.state)) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            createMatchCustomId(
              {
                action: 'MY_MATCH_INFO',
                matchId: view.matchId,
                version: view.version,
                phaseGeneration: view.phaseGeneration,
              },
              secret,
            ),
          )
          .setLabel('My Match Info')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
}

function renderRosters(players: readonly MatchDashboardPlayer[]): string {
  const team1 = players.filter((player) => player.team === 'TEAM_1');
  const team2 = players.filter((player) => player.team === 'TEAM_2');
  const unassigned = players.filter((player) => player.team === 'UNASSIGNED');
  const grouped =
    team1.length === 0 && team2.length === 0
      ? players.map((player) => player.displayName).join('\n')
      : [
          `**Team 1**\n${team1.map((player) => player.displayName).join('\n') || 'Pending'}`,
          `**Team 2**\n${team2.map((player) => player.displayName).join('\n') || 'Pending'}`,
          ...(unassigned.length === 0
            ? []
            : [`**Unassigned**\n${unassigned.map((player) => player.displayName).join('\n')}`]),
        ].join('\n\n');
  return truncateDiscordField(grouped || 'None');
}

function truncateDiscordField(value: string): string {
  return value.length <= 1024 ? value : `${value.slice(0, 1021)}...`;
}
