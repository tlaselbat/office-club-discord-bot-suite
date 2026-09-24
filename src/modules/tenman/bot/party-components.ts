import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { createPartyCustomId } from './party-custom-id.js';
import type { PartyService } from '../services/party-service.js';

type PartyPanelState = Awaited<ReturnType<PartyService['getPanelState']>>;

export function buildPartyPanelResponse(
  state: PartyPanelState,
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[];
} {
  const base = new EmbedBuilder().setTitle('Team Status').setColor(0x5865f2);
  if (!state.enabled) {
    return {
      embeds: [base.setDescription('Parties are disabled on this server.')],
      components: [refreshRow(guildId, actorDiscordUserId, secret)],
    };
  }
  if (state.party === null) {
    const description =
      state.pendingInvites.length === 0
        ? 'You are not in a team. Create one to queue together with friends.'
        : 'You are not in a team.';
    const embeds = [base.setDescription(description)];
    const components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[] = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createPartyCustomId({ action: 'CREATE', guildId, actorDiscordUserId }, secret),
          )
          .setLabel('Create Team')
          .setStyle(ButtonStyle.Success),
        refreshButton(guildId, actorDiscordUserId, secret),
      ),
    ];
    for (const invite of state.pendingInvites.slice(0, 3)) {
      embeds.push(
        new EmbedBuilder()
          .setTitle('Team invitation')
          .setColor(0xfee75c)
          .setDescription(
            `<@${invite.inviterDiscordUserId}> invited you. Expires <t:${String(Math.floor(invite.expiresAt.getTime() / 1000))}:R>.`,
          ),
      );
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              createPartyCustomId(
                {
                  action: 'ACCEPT',
                  guildId,
                  actorDiscordUserId,
                  inviteId: invite.id,
                },
                secret,
              ),
            )
            .setLabel('Accept Invitation')
            .setStyle(ButtonStyle.Primary),
        ),
      );
    }
    return { embeds, components };
  }

  const isLeader = state.party.leaderDiscordUserId === actorDiscordUserId;
  const members = state.party.members
    .map(
      (member) =>
        `<@${member.discordUserId}>${member.discordUserId === state.party?.leaderDiscordUserId ? ' (leader)' : ''}`,
    )
    .join('\n');
  const embeds = [
    base.setDescription('Your team. Members queue together.').addFields(
      { name: 'Members', value: members || 'None' },
      {
        name: 'Role',
        value: isLeader ? 'Leader' : 'Member',
        inline: true,
      },
      {
        name: 'Size',
        value: `${String(state.party.members.length)} / 5`,
        inline: true,
      },
    ),
  ];
  const components: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[] = [];
  if (isLeader && state.party.members.length < 5) {
    components.push(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createPartyCustomId(
              {
                action: 'INVITE',
                guildId,
                actorDiscordUserId,
                partyId: state.party.id,
              },
              secret,
            ),
          )
          .setPlaceholder('Invite a player')
          .setMaxValues(1),
      ),
    );
  }
  const actionRow = new ActionRowBuilder<ButtonBuilder>();
  if (isLeader) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          createPartyCustomId(
            {
              action: 'DISBAND',
              guildId,
              actorDiscordUserId,
              partyId: state.party.id,
            },
            secret,
          ),
        )
        .setLabel('Disband Team')
        .setStyle(ButtonStyle.Danger),
    );
  } else {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          createPartyCustomId(
            {
              action: 'LEAVE',
              guildId,
              actorDiscordUserId,
              partyId: state.party.id,
            },
            secret,
          ),
        )
        .setLabel('Leave Team')
        .setStyle(ButtonStyle.Danger),
    );
  }
  actionRow.addComponents(refreshButton(guildId, actorDiscordUserId, secret));
  components.push(actionRow);
  if (isLeader && state.party.members.length > 1) {
    components.push(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createPartyCustomId(
              {
                action: 'KICK',
                guildId,
                actorDiscordUserId,
                partyId: state.party.id,
              },
              secret,
            ),
          )
          .setPlaceholder('Remove a member')
          .setMaxValues(1),
      ),
    );
  }
  return { embeds, components };
}

/** Accept button delivered to the invitee via DM or ephemeral follow-up. */
export function buildPartyInviteAcceptRows(
  guildId: string,
  inviteeDiscordUserId: string,
  invites: Array<{ id: string }>,
  secret: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return invites.slice(0, 5).map((invite) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          createPartyCustomId(
            {
              action: 'ACCEPT',
              guildId,
              actorDiscordUserId: inviteeDiscordUserId,
              inviteId: invite.id,
            },
            secret,
          ),
        )
        .setLabel('Accept Team Invitation')
        .setStyle(ButtonStyle.Primary),
    ),
  );
}

function refreshButton(guildId: string, actorDiscordUserId: string, secret: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(createPartyCustomId({ action: 'PANEL', guildId, actorDiscordUserId }, secret))
    .setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary);
}

function refreshRow(
  guildId: string,
  actorDiscordUserId: string,
  secret: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    refreshButton(guildId, actorDiscordUserId, secret),
  );
}
