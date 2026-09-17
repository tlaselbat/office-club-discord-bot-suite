import { SlashCommandBuilder } from 'discord.js';

export const rewardCommands = [
  new SlashCommandBuilder()
    .setName('rewards')
    .setDescription('View office club rewards')
    .addSubcommand((command) =>
      command
        .setName('profile')
        .setDescription('Show reward XP, level, and rank')
        .addUserOption((option) => option.setName('member').setDescription('Member to view')),
    )
    .addSubcommand((command) =>
      command
        .setName('leaderboard')
        .setDescription('Show the reward leaderboard')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Leaderboard page').setMinValue(1),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('tag-status')
        .setDescription('Show office guild-tag loyalty progress')
        .addUserOption((option) => option.setName('member').setDescription('Member to view')),
    ),
].map((command) => command.toJSON());
