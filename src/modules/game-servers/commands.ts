import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const gameServerCommands = [
  new SlashCommandBuilder()
    .setName('servers')
    .setDescription('View and administer Office Club game servers')
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Game Servers administration')
        .addSubcommand((command) =>
          command
            .setName('setup')
            .setDescription('Create or repair the persistent Game Servers panel')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Panel text channel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('add')
            .setDescription('Select and register an accessible DatHost CS2 server')
            .addStringOption((option) =>
              option
                .setName('display-name')
                .setDescription('Public display name')
                .setMaxLength(24)
                .setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command.setName('list').setDescription('List all registrations'),
        )
        .addSubcommand((command) =>
          command
            .setName('edit')
            .setDescription('Edit a registered server')
            .addStringOption((option) =>
              option.setName('id').setDescription('Registration ID').setRequired(true),
            )
            .addStringOption((option) =>
              option.setName('display-name').setDescription('Public display name'),
            )
            .addStringOption((option) =>
              option.setName('description').setDescription('Description'),
            )
            .addBooleanOption((option) => option.setName('enabled').setDescription('Poll server'))
            .addBooleanOption((option) =>
              option.setName('public').setDescription('Show on public panel'),
            )
            .addStringOption((option) =>
              option.setName('connect-domain').setDescription('Stable connect domain'),
            )
            .addStringOption((option) =>
              option.setName('join-url').setDescription('HTTPS join URL'),
            )
            .addStringOption((option) =>
              option.setName('image-url').setDescription('Map/server thumbnail image URL'),
            )
            .addIntegerOption((option) =>
              option.setName('sort-order').setDescription('Display order'),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('remove')
            .setDescription('Remove local monitoring registration only')
            .addStringOption((option) =>
              option.setName('id').setDescription('Registration ID').setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName('test')
            .setDescription('Directly test read-only DatHost access')
            .addStringOption((option) =>
              option.setName('id').setDescription('Registration ID').setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command.setName('diagnostics').setDescription('Run explicit Game Servers diagnostics'),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];
