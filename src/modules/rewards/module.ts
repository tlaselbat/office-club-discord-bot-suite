import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  type MessageComponentInteraction,
} from 'discord.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Logger } from 'pino';
import type { SuiteModule } from '../../core/modules/types.js';
import { rewardCommands } from './commands.js';
import { RewardQueryService } from './services/reward-query-service.js';
import { RewardService } from './services/reward-service.js';
import { LevelRoleService } from './services/level-role-service.js';
import { VoiceActivityService } from './services/voice-activity-service.js';
import { TagLoyaltyService } from './services/tag-loyalty-service.js';
import type { JobHandler, LeasedJob } from '../../jobs/worker.js';
import { buildRewardPageId, parseRewardPageId } from './pagination.js';

export interface RewardsModuleDependencies {
  prisma: PrismaClient;
  discord?: Client;
  logger?: Logger;
  componentSigningSecret?: string;
}

export function createRewardsModule(dependencies?: RewardsModuleDependencies): SuiteModule {
  const prisma = dependencies?.prisma;
  const discord = dependencies?.discord;
  const voiceRuntime =
    prisma === undefined || discord === undefined
      ? undefined
      : {
          prisma,
          discord,
          service: new VoiceActivityService(
            prisma,
            new RewardService(prisma),
            new LevelRoleService(prisma, discord),
          ),
        };
  const tagRuntime =
    prisma === undefined || discord === undefined || dependencies?.logger === undefined
      ? undefined
      : new TagLoyaltyService(prisma, discord, dependencies.logger);
  return {
    key: 'member-rewards',
    displayName: 'Member Rewards',
    commands: rewardCommands,
    componentPrefixes: ['rw:'],
    ...(voiceRuntime === undefined
      ? {}
      : {
          jobHandlers: new Map<string, JobHandler>([
            [
              'REWARDS_VOICE_ACCRUAL',
              async () => {
                await voiceRuntime.service.accrue();
                return { rescheduleAt: new Date(Date.now() + 60_000) };
              },
            ],
            [
              'REWARDS_ROLE_RECONCILE',
              async (job: LeasedJob) => {
                const { guildId } = job.payload as { guildId: string };
                await new LevelRoleService(
                  voiceRuntime.prisma,
                  voiceRuntime.discord,
                ).reconcileGuild(guildId);
              },
            ],
            ...(tagRuntime === undefined
              ? []
              : [
                  [
                    'REWARDS_TAG_RECONCILE',
                    async () => {
                      const delayMs = await tagRuntime.reconcileEnabledGuilds();
                      return { rescheduleAt: new Date(Date.now() + delayMs) };
                    },
                  ] as const,
                ]),
          ]),
          start: async () => {
            await voiceRuntime.prisma.job.upsert({
              where: { idempotencyKey: 'rewards:voice-accrual' },
              update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
              create: {
                type: 'REWARDS_VOICE_ACCRUAL',
                idempotencyKey: 'rewards:voice-accrual',
                payload: {},
              },
            });
            if (tagRuntime !== undefined) {
              await voiceRuntime.prisma.job.upsert({
                where: { idempotencyKey: 'rewards:tag-reconcile' },
                update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
                create: {
                  type: 'REWARDS_TAG_RECONCILE',
                  idempotencyKey: 'rewards:tag-reconcile',
                  payload: {},
                },
              });
            }
            const settings = await voiceRuntime.prisma.rewardSettings.findMany({
              where: { enabled: true },
              select: { guildId: true },
            });
            for (const setting of settings) {
              const guild = await voiceRuntime.discord.guilds.fetch(setting.guildId);
              const connected = [...guild.voiceStates.cache.values()].flatMap((state) => {
                const member = state.member;
                return member === null || member.user.bot || state.channelId === null
                  ? []
                  : [
                      {
                        discordUserId: member.id,
                        displayName: member.displayName,
                        channelId: state.channelId,
                      },
                    ];
              });
              await voiceRuntime.service.reconcileGuild(setting.guildId, connected);
            }
            await tagRuntime?.reconcileEnabledGuilds();
          },
        }),
    ...(prisma === undefined
      ? {}
      : {
          handleInteraction: async ({ interaction }) => {
            const queries = new RewardQueryService(prisma);
            if (interaction.isChatInputCommand()) {
              await handleRewardsCommand(
                interaction,
                queries,
                dependencies?.componentSigningSecret,
              );
            } else {
              await handleLeaderboardComponent(
                interaction,
                queries,
                dependencies?.componentSigningSecret,
              );
            }
          },
        }),
  };
}

async function handleRewardsCommand(
  interaction: ChatInputCommandInteraction,
  queries: RewardQueryService,
  signingSecret?: string,
): Promise<void> {
  if (interaction.guildId === null) throw new Error('Guild command required');
  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'leaderboard') {
    const requestedPage = interaction.options.getInteger('page') ?? 1;
    const leaderboard = await queries.leaderboard(interaction.guildId, requestedPage);
    await interaction.editReply(
      renderLeaderboard(leaderboard, interaction.guildId, interaction.user.id, signingSecret),
    );
    return;
  }
  const target = interaction.options.getUser('member') ?? interaction.user;
  const profile = await queries.profile(interaction.guildId, target.id);
  if (subcommand === 'profile') {
    if (profile === null) {
      await interaction.editReply({ content: `<@${target.id}> has not earned XP yet.` });
      return;
    }
    const progress =
      profile.nextLevel === null
        ? 'Highest configured level reached'
        : `${String(profile.nextLevel.xpThreshold - profile.effectiveXp)} XP to level ${String(profile.nextLevel.level)}`;
    await interaction.editReply({
      content: `${profile.displayName}\n${String(profile.effectiveXp)} XP · Level ${String(profile.level)} · Rank #${String(profile.rank)}\n${progress}`,
    });
    return;
  }
  if (subcommand === 'tag-status') {
    const settings = await queries.tagSettings(interaction.guildId);
    if (settings.tagRewardRoleId === null) {
      await interaction.editReply({ content: 'The guild-tag loyalty reward is not configured.' });
      return;
    }
    if (profile?.tagQualifiedSince === null || profile === null) {
      await interaction.editReply({
        content: `<@${target.id}> does not have an active guild-tag streak.`,
      });
      return;
    }
    const qualifiesAt = new Date(
      profile.tagQualifiedSince.getTime() + settings.tagRequiredSeconds * 1000,
    );
    await interaction.editReply({
      content: profile.tagRoleGranted
        ? `<@${target.id}> has earned <@&${settings.tagRewardRoleId}>.`
        : `<@${target.id}> is eligible <t:${String(Math.floor(qualifiesAt.getTime() / 1000))}:R>.`,
    });
    return;
  }
  await interaction.editReply({ content: 'Unknown rewards command.' });
}

async function handleLeaderboardComponent(
  interaction: MessageComponentInteraction,
  queries: RewardQueryService,
  signingSecret?: string,
): Promise<void> {
  if (signingSecret === undefined) throw new Error('Rewards component signing is unavailable');
  const payload = parseRewardPageId(interaction.customId, signingSecret);
  if (interaction.guildId !== payload.guildId || interaction.user.id !== payload.requesterId) {
    throw new Error('Rewards page control does not belong to this user');
  }
  await interaction.deferUpdate();
  const leaderboard = await queries.leaderboard(payload.guildId, payload.page);
  await interaction.editReply(
    renderLeaderboard(
      leaderboard,
      payload.guildId,
      payload.requesterId,
      signingSecret,
      payload.expiresAt,
    ),
  );
}

function renderLeaderboard(
  leaderboard: Awaited<ReturnType<RewardQueryService['leaderboard']>>,
  guildId: string,
  requesterId: string,
  signingSecret?: string,
  expiresAt = Math.floor(Date.now() / 1000) + 15 * 60,
) {
  const lines = leaderboard.members.map((member, index) => {
    const rank = (leaderboard.page - 1) * leaderboard.pageSize + index + 1;
    return `${String(rank)}. ${member.user.displayName} — ${String(member.effectiveXp)} XP (Level ${String(member.currentLevel)})`;
  });
  const totalPages = Math.max(1, Math.ceil(leaderboard.total / leaderboard.pageSize));
  const components =
    signingSecret === undefined || totalPages === 1
      ? []
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                buildRewardPageId(
                  { guildId, requesterId, page: Math.max(1, leaderboard.page - 1), expiresAt },
                  signingSecret,
                ),
              )
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(leaderboard.page <= 1),
            new ButtonBuilder()
              .setCustomId(
                buildRewardPageId(
                  {
                    guildId,
                    requesterId,
                    page: Math.min(totalPages, leaderboard.page + 1),
                    expiresAt,
                  },
                  signingSecret,
                ),
              )
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(leaderboard.page >= totalPages),
          ),
        ];
  return {
    content:
      lines.length === 0
        ? 'No members have earned XP yet.'
        : `${lines.join('\n')}\nPage ${String(leaderboard.page)} of ${String(totalPages)}`,
    components,
  };
}
