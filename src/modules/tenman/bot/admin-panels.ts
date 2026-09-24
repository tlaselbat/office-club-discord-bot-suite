import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { createMatchOpsCustomId } from './match-ops-custom-id.js';
import { createQueueAdminCustomId } from './queue-admin-custom-id.js';
import { createPlayerAdminCustomId } from './player-admin-custom-id.js';
import { createResultDisputeCustomId } from './match-result-dispute-custom-id.js';
import { createSteamAccountCustomId } from './steam-account-custom-id.js';

const CONTROL_TTL_MS = 15 * 60 * 1000;

const FORMING_STATES = new Set(['READY_CHECK', 'TEAM_SELECTION', 'MAP_VETO']);
const TERMINAL_STATES = new Set(['FINISHED', 'CANCELED', 'FAILED']);

type AdminMatchView = {
  id: string;
  state: string;
  version: number;
  phaseGeneration: number;
  phaseDeadlineAt: Date | null;
  players: Array<{ discordUserId: string }>;
};

export function buildAdminMatchPanel(
  match: AdminMatchView,
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[];
} {
  const expiresAt = new Date(Date.now() + CONTROL_TTL_MS);
  const id = (action: Parameters<typeof createMatchOpsCustomId>[0]['action']) =>
    createMatchOpsCustomId(
      {
        action,
        matchId: match.id,
        version: match.version,
        phaseGeneration: match.phaseGeneration,
        actorDiscordUserId,
        expiresAt,
      },
      secret,
    );
  const embed = new EmbedBuilder()
    .setTitle(`10man Admin — Match ${match.id.slice(0, 8)}`)
    .setColor(0xed4245)
    .setDescription(
      [
        `State: **${match.state}**`,
        `Players: **${String(match.players.length)}**`,
        `Phase ends: ${
          match.phaseDeadlineAt === null
            ? '—'
            : `<t:${String(Math.floor(match.phaseDeadlineAt.getTime() / 1000))}:R>`
        }`,
      ].join('\n'),
    );

  const components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[] = [];
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (match.state === 'READY_CHECK') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(id('FR'))
        .setLabel('Force Ready')
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (FORMING_STATES.has(match.state)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(id('RP'))
        .setLabel('Restart Phase…')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (!TERMINAL_STATES.has(match.state)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(id('ST'))
        .setLabel('Stop Match…')
        .setStyle(ButtonStyle.Danger),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(id('RF')).setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  );
  components.push(row);

  if (match.state === 'READY_CHECK') {
    components.push(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(id('RO'))
          .setPlaceholder('Replace a player — pick who leaves')
          .setMaxValues(1),
      ),
    );
  }
  return { embeds: [embed], components };
}

export function buildReplaceIncomingSelect(
  match: AdminMatchView,
  guildId: string,
  actorDiscordUserId: string,
  outgoingDiscordUserId: string,
  secret: string,
): { content: string; components: ActionRowBuilder<UserSelectMenuBuilder>[] } {
  return {
    content: `Replacing <@${outgoingDiscordUserId}>. Now pick the incoming player — they must have an assigned Steam account.`,
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createMatchOpsCustomId(
              {
                action: 'RI',
                matchId: match.id,
                version: match.version,
                phaseGeneration: match.phaseGeneration,
                actorDiscordUserId,
                expiresAt: new Date(Date.now() + CONTROL_TTL_MS),
                targetDiscordUserId: outgoingDiscordUserId,
              },
              secret,
            ),
          )
          .setPlaceholder('Pick the replacement player')
          .setMaxValues(1),
      ),
    ],
  };
}

type QueueBanView = { discordUserId: string; reason: string; expiresAt: Date | null };

export function buildAdminQueuePanel(
  queue: { version: number; entries: Array<{ discordUserId: string }> } | null,
  bans: QueueBanView[],
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[];
} {
  const queued =
    queue === null
      ? 'No queue exists yet.'
      : `${String(queue.entries.length)} player(s) currently queued.`;
  const banList =
    bans.length === 0
      ? 'No active queue bans.'
      : bans
          .map(
            (ban) =>
              `• <@${ban.discordUserId}> — ${ban.reason}${
                ban.expiresAt === null
                  ? ''
                  : ` (until <t:${String(Math.floor(ban.expiresAt.getTime() / 1000))}:f>)`
              }`,
          )
          .join('\n');
  const expiresAt = new Date(Date.now() + CONTROL_TTL_MS);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('10man Admin — Queue')
        .setColor(0xed4245)
        .addFields(
          { name: 'Queue', value: queued },
          { name: 'Active bans', value: banList.slice(0, 1024) },
        ),
    ],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createQueueAdminCustomId(
              { action: 'BAN_SELECT', guildId, actorDiscordUserId, expiresAt },
              secret,
            ),
          )
          .setPlaceholder('Ban a player from the queue')
          .setMaxValues(1),
      ),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createQueueAdminCustomId(
              { action: 'UNBAN', guildId, actorDiscordUserId, expiresAt },
              secret,
            ),
          )
          .setPlaceholder('Unban a player')
          .setMaxValues(1),
      ),
    ],
  };
}

export function buildQueueBanModal(customId: string): ModalBuilder {
  return (
    new ModalBuilder()
      .setCustomId(customId)
      .setTitle('Queue Ban')
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('ban_reason')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('Reason')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(500)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('ban_duration_minutes')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('Duration in minutes (optional)')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(6)
            .setRequired(false),
        ),
      )
  );
}

export function buildAdminPlayersPanel(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<UserSelectMenuBuilder>[];
} {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('10man Admin — Players')
        .setColor(0xed4245)
        .setDescription(
          'Pick a player to reset their 10man stats. You will be asked to confirm before anything changes.',
        ),
    ],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createPlayerAdminCustomId(
              {
                action: 'SEL',
                guildId,
                targetDiscordUserId: '000000000000000000',
                actorDiscordUserId,
                expiresAt: Math.floor(Date.now() / 1000) + 900,
              },
              secret,
            ),
          )
          .setPlaceholder('Reset stats for a player')
          .setMaxValues(1),
      ),
    ],
  };
}

type ResultDisputeView = {
  id: string;
  matchId: string;
  discordUserId: string;
  reason: string;
  createdAt: Date;
};

type SteamDisputeView = {
  id: string;
  discordUserId: string;
  steamId64: string;
  createdAt: Date;
};

export function buildAdminDisputesPanel(
  steamDisputes: SteamDisputeView[],
  resultDisputes: ResultDisputeView[],
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setTitle('10man Admin — Disputes')
      .setColor(0xed4245)
      .addFields(
        {
          name: 'Result disputes',
          value:
            resultDisputes.length === 0
              ? 'None pending.'
              : resultDisputes
                  .map(
                    (dispute) =>
                      `• Match \`${dispute.matchId.slice(0, 8)}\` reported by <@${dispute.discordUserId}> <t:${String(Math.floor(dispute.createdAt.getTime() / 1000))}:R> — ${dispute.reason.slice(0, 200)}`,
                  )
                  .join('\n')
                  .slice(0, 1024),
        },
        {
          name: 'Steam account disputes',
          value:
            steamDisputes.length === 0
              ? 'None pending.'
              : steamDisputes
                  .map(
                    (dispute) =>
                      `• <@${dispute.discordUserId}> — \`${dispute.steamId64}\` — <t:${String(Math.floor(dispute.createdAt.getTime() / 1000))}:R>`,
                  )
                  .join('\n')
                  .slice(0, 1024),
        },
      ),
  ];
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const dispute of resultDisputes.slice(0, 2)) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createResultDisputeCustomId(
              {
                action: 'RES',
                guildId,
                actorDiscordUserId,
                matchId: dispute.matchId,
                disputeId: dispute.id,
                resolution: 'REVERSE',
              },
              secret,
            ),
          )
          .setLabel(`Reverse ${dispute.matchId.slice(0, 8)}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(
            createResultDisputeCustomId(
              {
                action: 'RES',
                guildId,
                actorDiscordUserId,
                matchId: dispute.matchId,
                disputeId: dispute.id,
                resolution: 'REJECT',
              },
              secret,
            ),
          )
          .setLabel(`Reject ${dispute.matchId.slice(0, 8)}`)
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  for (const dispute of steamDisputes.slice(0, 5 - components.length)) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createSteamAccountCustomId(
              { action: 'RESOLVE', guildId, actorDiscordUserId, disputeId: dispute.id },
              secret,
            ),
          )
          .setLabel(`Resolve Steam ${dispute.steamId64.slice(-6)}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(
            createSteamAccountCustomId(
              { action: 'REJECT', guildId, actorDiscordUserId, disputeId: dispute.id },
              secret,
            ),
          )
          .setLabel(`Reject Steam ${dispute.steamId64.slice(-6)}`)
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { embeds, components };
}

export function buildResultResolutionModal(customId: string, resolution: string): ModalBuilder {
  return (
    new ModalBuilder()
      .setCustomId(customId)
      .setTitle(resolution === 'REVERSE' ? 'Reverse Result' : 'Reject Dispute')
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('resolution_reason')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('Staff-visible resolution reason')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      )
  );
}

type HistoryMatchView = {
  id: string;
  selectedMap: string | null;
  score: unknown;
  result: unknown;
  resultStatus: string;
  finishedAt: Date | null;
  version: number;
  phaseGeneration: number;
  players: Array<{ team: string }>;
};

export function buildHistoryResponse(
  matches: HistoryMatchView[],
  targetDiscordUserId: string,
  viewerIsStaff: boolean,
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  if (matches.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('10man History')
          .setColor(0x5865f2)
          .setDescription(`No finished 10man matches for <@${targetDiscordUserId}> yet.`),
      ],
      components: [],
    };
  }
  const lines = matches.map((match) => {
    const parsedScore = match.score as { team1?: number; team2?: number } | null;
    const score =
      parsedScore === null || parsedScore.team1 === undefined || parsedScore.team2 === undefined
        ? 'score pending'
        : `${String(parsedScore.team1)} — ${String(parsedScore.team2)}`;
    const team = match.players[0]?.team;
    const winner = (match.result as { winner?: { team?: string } } | null)?.winner?.team;
    const outcome =
      match.resultStatus === 'REVERSED'
        ? 'reversed'
        : winner === undefined
          ? 'recorded'
          : team === winner
            ? 'win'
            : 'loss';
    const when =
      match.finishedAt === null
        ? ''
        : ` <t:${String(Math.floor(match.finishedAt.getTime() / 1000))}:R>`;
    return `• \`${match.id.slice(0, 8)}\` — ${match.selectedMap ?? 'unknown map'} — ${score} — ${outcome}${team === undefined ? '' : ` (${team === 'TEAM_1' ? 'Team 1' : 'Team 2'})`}${when}`;
  });
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (viewerIsStaff) {
    const rollbackable = matches.filter((match) => match.resultStatus === 'APPLIED').slice(0, 5);
    for (const match of rollbackable) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              createMatchOpsCustomId(
                {
                  action: 'RB',
                  matchId: match.id,
                  version: match.version,
                  phaseGeneration: match.phaseGeneration,
                  actorDiscordUserId,
                  expiresAt: new Date(Date.now() + CONTROL_TTL_MS),
                },
                secret,
              ),
            )
            .setLabel(`Rollback ${match.id.slice(0, 8)}…`)
            .setStyle(ButtonStyle.Danger),
        ),
      );
    }
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`10man History — <@${targetDiscordUserId}>`)
        .setColor(0x5865f2)
        .setDescription(lines.join('\n')),
    ],
    components,
  };
}
