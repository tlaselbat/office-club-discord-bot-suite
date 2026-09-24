import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { formatSteamId64InputHelp } from '../domain/steam-id.js';
import { createSteamAccountCustomId } from './steam-account-custom-id.js';

export function buildSteamAccountButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          createSteamAccountCustomId({ action: 'VIEW', guildId, actorDiscordUserId }, secret),
        )
        .setLabel('Steam Account')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildAssignSteamAccountButton(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          createSteamAccountCustomId({ action: 'OPEN', guildId, actorDiscordUserId }, secret),
        )
        .setLabel('Assign Steam Account')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function buildSteamAssignmentModal(customId: string): ModalBuilder {
  return (
    new ModalBuilder()
      .setCustomId(customId)
      .setTitle('Assign Steam Account')
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('steam_identifier')
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            .setLabel('Steam ID or profile URL')
            .setPlaceholder('76561198012345678')
            .setStyle(TextInputStyle.Short)
            .setMinLength(4)
            .setMaxLength(128)
            .setRequired(true),
        ),
      )
  );
}

export function buildAssignmentSuccessResponse(
  steamId64: string,
  displayName: string | null,
): string {
  const profile = displayName === null ? '' : `Player: **${displayName}**\n`;
  return [
    'Steam account assigned.',
    `${profile}SteamID64: \`${steamId64}\``,
    'This association is used to build the CS2 match roster. It does not verify Steam ownership.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildDuplicateAssignmentResponse(
  guildId: string,
  actorDiscordUserId: string,
  steamId64: string,
  secret: string,
): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  return {
    content:
      'That Steam account is already assigned to another Discord account. A Steam ID alone does not prove ownership, so the bot cannot decide which account should keep it.',
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createSteamAccountCustomId({ action: 'OTHER', guildId, actorDiscordUserId }, secret),
          )
          .setLabel('Use Different Account')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(
            createSteamAccountCustomId(
              {
                action: 'REVIEW',
                guildId,
                actorDiscordUserId,
                targetDiscordUserId: actorDiscordUserId,
                steamId64,
              },
              secret,
            ),
          )
          .setLabel('Request Staff Review')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildLockedAssignmentResponse(reason: 'QUEUED' | 'MATCH'): string {
  const context =
    reason === 'QUEUED'
      ? 'You are currently in the 10man queue.'
      : 'You are currently part of an active 10man roster.';
  return `Steam account can't be changed right now. ${context} Leave the queue or finish the current match first.`;
}

export function buildInvalidInputResponse(): string {
  return ['That does not look like a supported Steam identifier.', formatSteamId64InputHelp()].join(
    '\n',
  );
}

export function buildApiUnavailableResponse(): string {
  return [
    'Steam profile information is temporarily unavailable for that vanity URL.',
    'You can enter a numeric SteamID64, Steam2, Steam3, or profile URL instead.',
  ].join('\n');
}

export function buildDisputeAcknowledgedResponse(reportId: string): string {
  return `Report received. Staff can review the match and its assignment history. Your report ID is \`${reportId.slice(0, 8)}\`.`;
}
