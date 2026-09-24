import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  buildAssignSteamAccountButton,
  buildSteamAccountButton,
} from './steam-account-components.js';
import { createPlayerHubCustomId } from './player-hub-custom-id.js';
import { createQueueCustomId } from './queue-custom-id.js';
import { createMatchCustomId } from './match-custom-id.js';
import { createPartyCustomId } from './party-custom-id.js';
import { createResultDisputeCustomId } from './match-result-dispute-custom-id.js';
import type { PlayerStatus } from '../services/player-status-service.js';
import { matchPhaseLabel } from './presentation.js';

export function buildPlayerHubResponse(
  status: PlayerStatus,
  guildId: string,
  discordUserId: string,
  queueVersion: number,
  matchVersion: number,
  matchPhaseGeneration: number,
  secret: string,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const base = new EmbedBuilder().setTitle('Your 10man').setColor(0x5865f2);
  const nav = navRow(guildId, discordUserId, secret);

  switch (status.kind) {
    case 'NEW_PLAYER':
      return {
        embeds: [
          base
            .setDescription(
              'Welcome to 10man. Assign the Steam account you intend to use, then join the queue when there are enough players.',
            )
            .addFields(
              { name: 'Steam account', value: 'Not assigned', inline: true },
              { name: 'Queue', value: 'Not joined', inline: true },
            ),
        ],
        components: [
          ...buildAssignSteamAccountButton(guildId, discordUserId, secret),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            howItWorksButton(guildId, discordUserId, queueVersion, secret),
            refreshButton(guildId, discordUserId, secret),
          ),
          nav,
        ],
      };

    case 'READY_TO_QUEUE':
      return {
        embeds: [
          base
            .setDescription(
              'Your Steam account is assigned. You can join the queue when it is open.',
            )
            .addFields(
              {
                name: 'Queue',
                value: `${String(status.playersInQueue)} / ${String(status.queueSize)} players`,
                inline: true,
              },
              { name: 'Status', value: 'Ready to join', inline: true },
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                createQueueCustomId({ action: 'JOIN', guildId, version: queueVersion }, secret),
              )
              .setLabel('Join Queue')
              .setStyle(ButtonStyle.Success),
          ),
          ...buildSteamAccountButton(guildId, discordUserId, secret),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            howItWorksButton(guildId, discordUserId, queueVersion, secret),
            refreshButton(guildId, discordUserId, secret),
          ),
          nav,
        ],
      };

    case 'QUEUED':
      return {
        embeds: [
          base
            .setDescription(
              `You are in the queue. Waiting for ${String(Math.max(0, status.queueSize - status.playersInQueue))} more player${status.queueSize - status.playersInQueue === 1 ? '' : 's'} — you can leave any time before the ready check starts.`,
            )
            .addFields(
              { name: 'Status', value: 'In queue', inline: true },
              { name: 'Position', value: String(status.position), inline: true },
              {
                name: 'Players',
                value: `${String(status.playersInQueue)} / ${String(status.queueSize)}`,
                inline: true,
              },
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                createQueueCustomId({ action: 'LEAVE', guildId, version: queueVersion }, secret),
              )
              .setLabel('Leave Queue')
              .setStyle(ButtonStyle.Danger),
          ),
          ...buildSteamAccountButton(guildId, discordUserId, secret),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            howItWorksButton(guildId, discordUserId, queueVersion, secret),
            refreshButton(guildId, discordUserId, secret),
          ),
          nav,
        ],
      };

    case 'READY_CHECK':
      return {
        embeds: [
          base.setDescription(
            `Ready check is waiting for you. Ends <t:${String(Math.floor(status.deadlineAt.getTime() / 1000))}:R>.`,
          ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                createMatchCustomId(
                  {
                    action: 'READY',
                    matchId: status.matchId,
                    version: matchVersion,
                    phaseGeneration: matchPhaseGeneration,
                  },
                  secret,
                ),
              )
              .setLabel("I'm Ready")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(
                createMatchCustomId(
                  {
                    action: 'WITHDRAW_READY',
                    matchId: status.matchId,
                    version: matchVersion,
                    phaseGeneration: matchPhaseGeneration,
                  },
                  secret,
                ),
              )
              .setLabel('Withdraw')
              .setStyle(ButtonStyle.Secondary),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            refreshButton(guildId, discordUserId, secret),
          ),
          nav,
        ],
      };

    case 'MATCH_ACTIVE':
      return {
        embeds: [
          base
            .setDescription('You have an active 10man match.')
            .addFields(
              { name: 'Phase', value: matchPhaseLabel(status.state), inline: true },
              { name: 'Map', value: status.selectedMap ?? 'Pending', inline: true },
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                createMatchCustomId(
                  {
                    action: 'MY_MATCH_INFO',
                    matchId: status.matchId,
                    version: matchVersion,
                    phaseGeneration: matchPhaseGeneration,
                  },
                  secret,
                ),
              )
              .setLabel('My Match Info')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(
                createMatchCustomId(
                  {
                    action: 'CANCEL',
                    matchId: status.matchId,
                    version: matchVersion,
                    phaseGeneration: matchPhaseGeneration,
                  },
                  secret,
                ),
              )
              .setLabel('Cancel Match…')
              .setStyle(ButtonStyle.Danger),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            refreshButton(guildId, discordUserId, secret),
          ),
          nav,
        ],
      };

    case 'TERMINAL': {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createQueueCustomId({ action: 'JOIN', guildId, version: queueVersion }, secret),
          )
          .setLabel('Join Queue Again')
          .setStyle(ButtonStyle.Success),
      );
      if (status.state === 'FINISHED') {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(
              createResultDisputeCustomId(
                {
                  action: 'REPORT',
                  guildId,
                  actorDiscordUserId: discordUserId,
                  matchId: status.matchId,
                },
                secret,
              ),
            )
            .setLabel('Report Result Issue')
            .setStyle(ButtonStyle.Danger),
        );
      }
      return {
        embeds: [
          base.setDescription(
            status.state === 'FINISHED'
              ? 'Your previous match has ended. Cleanup is finishing before the queue reopens.'
              : `Match ended: ${matchPhaseLabel(status.state)}.`,
          ),
        ],
        components: [
          row,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            refreshButton(guildId, discordUserId, secret),
          ),
          nav,
        ],
      };
    }
  }
}

function navRow(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(createPartyCustomId({ action: 'PANEL', guildId, actorDiscordUserId }, secret))
      .setLabel('My Party')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        createPlayerHubCustomId({ action: 'HISTORY', guildId, actorDiscordUserId }, secret),
      )
      .setLabel('History')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        createPlayerHubCustomId({ action: 'STATS', guildId, actorDiscordUserId }, secret),
      )
      .setLabel('Stats')
      .setStyle(ButtonStyle.Secondary),
  );
}

function howItWorksButton(
  guildId: string,
  actorDiscordUserId: string,
  queueVersion: number,
  secret: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      createQueueCustomId({ action: 'HOW_IT_WORKS', guildId, version: queueVersion }, secret),
    )
    .setLabel('How It Works')
    .setStyle(ButtonStyle.Secondary);
}

function refreshButton(guildId: string, actorDiscordUserId: string, secret: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createPlayerHubCustomId({ action: 'HUB', guildId, actorDiscordUserId }, secret))
    .setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary);
}
