import { ChannelType, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('10man')
    .setDescription('Manage a CS2 10man')
    .addSubcommand((command) =>
      command.setName('queue').setDescription('Create or repair the persistent 10man queue panel'),
    )
    .addSubcommand((command) =>
      command.setName('hub').setDescription('Open your personal 10man status'),
    )
    .addSubcommand((command) => command.setName('status').setDescription('Show the active 10man'))
    .addSubcommand((command) => command.setName('cancel').setDescription('Cancel the active 10man'))
    .addSubcommand((command) =>
      command
        .setName('alerts')
        .setDescription('Opt in or out of 10man queue fill alerts')
        .addBooleanOption((option) =>
          option
            .setName('enabled')
            .setDescription('Whether to receive direct-message queue alerts')
            .setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('steam')
    .setDescription('Manage your assigned Steam account for 10man matches')
    .addSubcommand((command) =>
      command
        .setName('account')
        .setDescription('View or assign the Steam account you intend to use'),
    ),
  new SlashCommandBuilder()
    .setName('match')
    .setDescription('Match information and administrative controls')
    .addSubcommand((command) =>
      command
        .setName('history')
        .setDescription('Show recent finished matches for a player')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to view (defaults to you)'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Configure and diagnose 10mans')
        .addSubcommand((command) =>
          command.setName('status').setDescription('Show configuration status'),
        )
        .addSubcommand((command) =>
          command.setName('diagnostics').setDescription('Run safe diagnostics'),
        )
        .addSubcommand((command) =>
          command.setName('panel').setDescription('Show an ephemeral administrative match panel'),
        )
        .addSubcommand((command) =>
          command.setName('force-ready').setDescription('Force the active ready check forward'),
        )
        .addSubcommand((command) =>
          command
            .setName('restart-phase')
            .setDescription('Request a protected restart of the active forming phase'),
        )
        .addSubcommand((command) =>
          command
            .setName('reset-player-stats')
            .setDescription("Request a protected reset of a player's standings")
            .addUserOption((option) =>
              option
                .setName('player')
                .setDescription('Player whose standings to reset')
                .setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('replace-player')
            .setDescription('Replace a participant during ready check')
            .addUserOption((option) =>
              option.setName('outgoing').setDescription('Current participant').setRequired(true),
            )
            .addUserOption((option) =>
              option.setName('incoming').setDescription('Assigned replacement').setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('rollback')
            .setDescription('Request an audited rollback of an applied result')
            .addStringOption((option) =>
              option
                .setName('match_id')
                .setDescription('Full UUID of the finished match')
                .setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('queue-ban')
            .setDescription('Ban a player from the queue')
            .addUserOption((option) =>
              option.setName('player').setDescription('Player to ban').setRequired(true),
            )
            .addStringOption((option) =>
              option.setName('reason').setDescription('Reason for the queue ban').setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName('duration_minutes')
                .setDescription('Optional expiry in minutes')
                .setMinValue(1)
                .setMaxValue(525600),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('queue-unban')
            .setDescription('Revoke a player queue ban')
            .addUserOption((option) =>
              option.setName('player').setDescription('Player to unban').setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command.setName('result-disputes').setDescription('List pending match result disputes'),
        )
        .addSubcommand((command) =>
          command
            .setName('resolve-result-dispute')
            .setDescription('Resolve a match result dispute')
            .addStringOption((option) =>
              option
                .setName('dispute_id')
                .setDescription('Full UUID of the dispute')
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Resolution action')
                .setRequired(true)
                .addChoices(
                  { name: 'Reject', value: 'REJECT' },
                  { name: 'Reverse result', value: 'REVERSE' },
                ),
            )
            .addStringOption((option) =>
              option
                .setName('reason')
                .setDescription('Staff-visible resolution reason')
                .setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('steam-disputes')
            .setDescription('List pending Steam assignment disputes'),
        )
        .addSubcommand((command) =>
          command
            .setName('resolve-steam-dispute')
            .setDescription('Resolve a Steam assignment dispute')
            .addStringOption((option) =>
              option
                .setName('dispute_id')
                .setDescription('Full UUID of the dispute')
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('Resolution action')
                .setRequired(true)
                .addChoices(
                  { name: 'Reject', value: 'REJECT' },
                  { name: 'Force replace', value: 'FORCE_REPLACE' },
                  { name: 'Force remove', value: 'FORCE_REMOVE' },
                ),
            )
            .addStringOption((option) =>
              option
                .setName('reason')
                .setDescription('Staff-visible resolution reason')
                .setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('setup')
            .setDescription('Create and configure managed 10man channels')
            .addRoleOption((option) =>
              option.setName('privileged_role').setDescription('Role that can create 10mans'),
            )
            .addRoleOption((option) =>
              option.setName('moderator_role').setDescription('Role for match overrides'),
            )
            .addRoleOption((option) =>
              option.setName('administrator_role').setDescription('Role for bot administration'),
            )
            .addStringOption((option) =>
              option
                .setName('dathost_template_server_id')
                .setDescription('DatHost template server ID'),
            )
            .addStringOption((option) =>
              option.setName('dathost_location').setDescription('DatHost server location'),
            )
            .addStringOption((option) =>
              option.setName('default_game_profile').setDescription('Default game profile key'),
            ),
        )
        .addSubcommand((command) =>
          command.setName('recover-setup').setDescription('Recover interrupted managed setup'),
        )
        .addSubcommand((command) =>
          command.setName('disable').setDescription('Disable new 10man creation'),
        )
        .addSubcommand((command) =>
          command.setName('enable').setDescription('Validate and enable this server'),
        )
        .addSubcommand((command) =>
          command.setName('teardown').setDescription('Archive and lock bot-managed 10man channels'),
        )
        .addSubcommand((command) =>
          command
            .setName('configure')
            .setDescription('Configure this server for 10mans')
            .addChannelOption((option) =>
              option
                .setName('lobby_text_channel')
                .setDescription('Channel for the persistent match panel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            )
            .addChannelOption((option) =>
              option
                .setName('lobby_voice_channel')
                .setDescription('Lobby voice channel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice),
            )
            .addChannelOption((option) =>
              option
                .setName('team1_voice_channel')
                .setDescription('Team 1 voice channel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice),
            )
            .addChannelOption((option) =>
              option
                .setName('team2_voice_channel')
                .setDescription('Team 2 voice channel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice),
            )
            .addRoleOption((option) =>
              option
                .setName('privileged_role')
                .setDescription('Role that can create 10mans')
                .setRequired(true),
            )
            .addRoleOption((option) =>
              option
                .setName('moderator_role')
                .setDescription('Role that can override match controls')
                .setRequired(true),
            )
            .addRoleOption((option) =>
              option
                .setName('administrator_role')
                .setDescription('Role for full admin controls')
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName('dathost_template_server_id')
                .setDescription('DatHost template server ID')
                .setRequired(true),
            )
            .addChannelOption((option) =>
              option
                .setName('results_channel')
                .setDescription('Bot-post-only channel for retained match results')
                .addChannelTypes(ChannelType.GuildText),
            )
            .addStringOption((option) =>
              option
                .setName('dathost_location')
                .setDescription('DatHost server location')
                .setRequired(false),
            )
            .addStringOption((option) =>
              option
                .setName('default_game_profile')
                .setDescription('Default game profile key')
                .setRequired(false),
            )
            .addIntegerOption((option) =>
              option
                .setName('queue_size')
                .setDescription('Queue size (must match the selected profile)')
                .setMinValue(2)
                .setMaxValue(100),
            )
            .addIntegerOption((option) =>
              option
                .setName('ready_timeout_seconds')
                .setDescription('Ready-check timeout in seconds')
                .setMinValue(15)
                .setMaxValue(900),
            )
            .addBooleanOption((option) =>
              option.setName('party_enabled').setDescription('Enable party management'),
            )
            .addStringOption((option) =>
              option
                .setName('team_selection')
                .setDescription('Team selection policy')
                .addChoices(
                  { name: 'Captains', value: 'CAPTAINS' },
                  { name: 'Random teams', value: 'RANDOM' },
                ),
            )
            .addStringOption((option) =>
              option
                .setName('map_selection')
                .setDescription('Map selection policy')
                .addChoices(
                  { name: 'Captain veto', value: 'CAPTAIN_VETO' },
                  { name: 'Random map', value: 'RANDOM' },
                ),
            ),
        ),
    ),
  new SlashCommandBuilder()
    .setName('player')
    .setDescription('View 10man player statistics')
    .addSubcommand((command) =>
      command
        .setName('stats')
        .setDescription('Show a player rating and record')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to view (defaults to you)'),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('matches')
        .setDescription('Show recent finished matches for a player')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to view (defaults to you)'),
        ),
    ),
  new SlashCommandBuilder()
    .setName('party')
    .setDescription('Manage your 10man party')
    .addSubcommand((command) => command.setName('create').setDescription('Create a party'))
    .addSubcommand((command) =>
      command
        .setName('invite')
        .setDescription('Invite a player to your party')
        .addStringOption((option) =>
          option.setName('party_id').setDescription('Your party UUID').setRequired(true),
        )
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to invite').setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('accept')
        .setDescription('Accept a party invitation')
        .addStringOption((option) =>
          option.setName('invite_id').setDescription('Invitation UUID').setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('leave')
        .setDescription('Leave a party')
        .addStringOption((option) =>
          option.setName('party_id').setDescription('Party UUID').setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('kick')
        .setDescription('Remove a player from your party')
        .addStringOption((option) =>
          option.setName('party_id').setDescription('Your party UUID').setRequired(true),
        )
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to remove').setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('disband')
        .setDescription('Disband your party')
        .addStringOption((option) =>
          option.setName('party_id').setDescription('Party UUID').setRequired(true),
        ),
    ),
].map((command) => command.toJSON());
