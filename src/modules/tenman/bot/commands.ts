import { ChannelType, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('match')
    .setDescription('Office Club Competitive: Match Queue, Match Center, and match controls')
    .addSubcommand((command) =>
      command.setName('center').setDescription('Open your Match Center status and controls'),
    )
    .addSubcommand((command) =>
      command
        .setName('account')
        .setDescription('Manage your Steam account for Office Club Competitive matches'),
    )
    .addSubcommand((command) =>
      command
        .setName('history')
        .setDescription('Show recent Match History')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to view (defaults to you)'),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('stats')
        .setDescription('Show a player rating and record')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to view (defaults to you)'),
        ),
    )
    .addSubcommand((command) =>
      command.setName('team').setDescription('Open your Team Status panel'),
    )
    .addSubcommand((command) =>
      command
        .setName('alerts')
        .setDescription('Opt in or out of Match Queue fill alerts')
        .addBooleanOption((option) =>
          option
            .setName('enabled')
            .setDescription('Whether to receive direct-message queue alerts')
            .setRequired(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Staff controls for the match, queue, players, and disputes')
        .addSubcommand((command) =>
          command.setName('match').setDescription('Open the admin panel for the active match'),
        )
        .addSubcommand((command) =>
          command.setName('queue').setDescription('Open queue moderation controls'),
        )
        .addSubcommand((command) =>
          command.setName('players').setDescription('Open player administration controls'),
        )
        .addSubcommand((command) =>
          command.setName('disputes').setDescription('Review pending result and account disputes'),
        )
        .addSubcommand((command) =>
          command
            .setName('diagnostics')
            .setDescription('Run safe Office Club Competitive diagnostics'),
        )
        .addSubcommand((command) =>
          command
            .setName('queue-panel')
            .setDescription('Create or repair the persistent Match Queue panel'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('config')
        .setDescription('Set up, configure, or tear down Office Club Competitive on this server')
        .addSubcommand((command) =>
          command.setName('status').setDescription('Show configuration status'),
        )
        .addSubcommand((command) =>
          command
            .setName('setup')
            .setDescription('Create and configure managed competitive channels')
            .addRoleOption((option) =>
              option
                .setName('privileged_role')
                .setDescription('Role that can create competitive matches'),
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
          command
            .setName('configure')
            .setDescription('Configure this server for Office Club Competitive matches')
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
                .setDescription('Role that can create competitive matches')
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
              option.setName('party_enabled').setDescription('Enable team management'),
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
        )
        .addSubcommand((command) =>
          command.setName('enable').setDescription('Validate and enable this server'),
        )
        .addSubcommand((command) =>
          command.setName('disable').setDescription('Disable new competitive match creation'),
        )
        .addSubcommand((command) =>
          command
            .setName('teardown')
            .setDescription('Archive and lock bot-managed competitive channels'),
        )
        .addSubcommand((command) =>
          command.setName('recover-setup').setDescription('Recover interrupted managed setup'),
        ),
    ),
].map((command) => command.toJSON());
