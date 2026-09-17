import { ChannelType, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('10man')
    .setDescription('Manage a CS2 10man')
    .addSubcommand((command) => command.setName('create').setDescription('Create a new 10man'))
    .addSubcommand((command) => command.setName('status').setDescription('Show the active 10man'))
    .addSubcommand((command) =>
      command.setName('cancel').setDescription('Cancel the active 10man'),
    ),
  new SlashCommandBuilder()
    .setName('steam')
    .setDescription('Manage your verified Steam account')
    .addSubcommand((command) =>
      command.setName('register').setDescription('Link through Steam OpenID'),
    )
    .addSubcommand((command) => command.setName('status').setDescription('Show your Steam link'))
    .addSubcommand((command) =>
      command.setName('replace').setDescription('Replace your Steam link'),
    ),
  new SlashCommandBuilder()
    .setName('match')
    .setDescription('Administrative match controls')
    .addSubcommand((command) =>
      command
        .setName('transfer')
        .setDescription('Transfer leader to a participant')
        .addUserOption((option) =>
          option
            .setName('player')
            .setDescription('The participant to promote to leader')
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('remove')
        .setDescription('Remove a participant from the active match')
        .addUserOption((option) =>
          option.setName('player').setDescription('The participant to remove').setRequired(true),
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
          command.setName('teardown').setDescription('Delete bot-managed 10man channels'),
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
            ),
        ),
    ),
].map((command) => command.toJSON());
