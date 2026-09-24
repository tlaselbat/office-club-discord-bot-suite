import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { buildSteamAccountButton } from './steam-account-components.js';
import { createPlayerHubCustomId } from './player-hub-custom-id.js';
import { createQueueCustomId } from './queue-custom-id.js';
import { createMatchCustomId } from './match-custom-id.js';
import { compactMatchUuid, createResultDisputeCustomId } from './match-result-dispute-custom-id.js';
import type { PlayerStatus } from '../services/player-status-service.js';

export function buildPlayerHubResponse(
  status: PlayerStatus,
  guildId: string,
  discordUserId: string,
  queueVersion: number,
  matchVersion: number,
  matchPhaseGeneration: number,
  secret: string,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const base = new EmbedBuilder().setTitle('Your 10man Status').setColor(0x5865f2);

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
          ...buildSteamAccountButton(guildId, discordUserId, secret),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            howItWorksButton(guildId, discordUserId, queueVersion, secret),
            refreshButton(guildId, discordUserId, secret),
          ),
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
        ],
      };

    case 'QUEUED':
      return {
        embeds: [
          base
            .setDescription(
              'You are in the queue. You can leave at any time until the ready check starts.',
            )
            .addFields(
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
        ],
      };

    case 'MATCH_ACTIVE':
      return {
        embeds: [
          base
            .setDescription('You have an active 10man match.')
            .addFields(
              { name: 'State', value: plainStateName(status.state), inline: true },
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
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            refreshButton(guildId, discordUserId, secret),
          ),
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
                  matchId: compactMatchUuid(status.matchId),
                },
                secret,
              ),
            )
            .setLabel('Report Result Issue')
            .setStyle(ButtonStyle.Danger),
        );
      }
      return {
        embeds: [base.setDescription(`Match ended with state: ${plainStateName(status.state)}.`)],
        components: [
          row,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            refreshButton(guildId, discordUserId, secret),
          ),
        ],
      };
    }
  }
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

function plainStateName(state: string): string {
  switch (state) {
    case 'SERVER_PROVISIONING':
      return 'Preparing server';
    case 'SERVER_BOOTING':
      return 'Starting CS2 server';
    case 'SERVER_READY':
      return 'Server nearly ready';
    case 'MATCH_LOADED':
      return 'Server ready';
    case 'WARMUP':
      return 'Warmup';
    case 'LIVE':
      return 'Match live';
    case 'PAUSED':
      return 'Match paused';
    case 'FINISHED':
      return 'Match complete';
    case 'CANCELED':
      return 'Match canceled';
    case 'FAILED':
      return 'Match failed';
    default:
      return state.replaceAll('_', ' ').toLowerCase();
  }
}
