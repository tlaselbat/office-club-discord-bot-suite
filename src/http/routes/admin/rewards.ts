import { ChannelType } from 'discord.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PublicError } from '../../../errors/public-error.js';
import { RewardSettingsService } from '../../../modules/rewards/services/reward-settings-service.js';
import { RewardService } from '../../../modules/rewards/services/reward-service.js';
import { RewardDiagnosticsService } from '../../../modules/rewards/services/reward-diagnostics-service.js';
import { rewardsPage } from '../../admin/views.js';
import { idSchema, isProductionReady } from './shared.js';
import type { SharedHelpers } from './shared.js';

const rewardSettingsSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.union([z.literal('new'), z.coerce.number().int().nonnegative()]),
    textXpAmount: z.coerce.number().int().min(1).max(100000),
    textCooldownSeconds: z.coerce.number().int().min(1).max(86400),
    voiceXpAmount: z.coerce.number().int().min(1).max(100000),
    voiceIntervalSeconds: z.coerce.number().int().min(60).max(86400),
    textChannelIds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(idSchema).max(100),
    ),
    voiceChannelIds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(idSchema).max(100),
    ),
    tagRequiredSeconds: z.coerce.number().int().min(60).max(31536000),
    tagRewardRoleId: z.union([idSchema, z.literal('')]).optional(),
    tagReconcileSeconds: z.coerce.number().int().min(60).max(86400),
  })
  .strict();

const rewardLevelsSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.union([z.literal('new'), z.coerce.number().int().nonnegative()]),
    levelNumbers: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(z.string().max(128)).max(25),
    ),
    levelThresholds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(z.string().max(128)).max(25),
    ),
    levelLabels: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(z.string().max(128)).max(25),
    ),
    levelRoleIds: z.preprocess(
      (value: unknown): unknown =>
        Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value],
      z.array(z.string().max(128)).max(25),
    ),
  })
  .strict();

const rewardToggleSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    version: z.coerce.number().int().nonnegative(),
  })
  .strict();

const rewardAdjustmentSchema = z
  .object({
    csrf: z.string().min(1).max(128),
    adjustmentId: z.uuid(),
    discordUserId: idSchema,
    amount: z.coerce
      .number()
      .int()
      .min(-1000000)
      .max(1000000)
      .refine((value) => value !== 0),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export function registerRewardsRoutes(app: FastifyInstance, shared: SharedHelpers): void {
  const rewardSettings = new RewardSettingsService(shared.deps.prisma, shared.deps.discord);
  const rewards = new RewardService(shared.deps.prisma);
  const rewardDiagnostics = new RewardDiagnosticsService(shared.deps.prisma, shared.deps.discord);

  const fetchOptions = async (guildId: string) => {
    const discordGuild = await shared.deps.discord.guilds.fetch(guildId);
    const [channels, roles, members] = await Promise.all([
      discordGuild.channels.fetch(),
      discordGuild.roles.fetch(),
      discordGuild.members.fetch(),
    ]);
    const channelList = [...channels.values()].filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    return {
      textChannels: channelList
        .filter((item) => item.type === ChannelType.GuildText)
        .map((item) => ({ id: item.id, name: item.name })),
      voiceChannels: channelList
        .filter((item) => item.type === ChannelType.GuildVoice)
        .map((item) => ({ id: item.id, name: item.name })),
      roles: [...roles.values()]
        .filter((item) => item.id !== discordGuild.id && !item.managed)
        .map((item) => ({ id: item.id, name: item.name })),
      members: [...members.values()]
        .filter((member) => !member.user.bot)
        .map((member) => ({
          id: member.user.id,
          name: member.displayName || member.user.username,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  };

  const buildRewardsPage = async (
    guildId: string,
    auth: { discordUserId: string; csrf: string },
    options?: {
      diagnostics?: Awaited<ReturnType<typeof rewardDiagnostics.run>>;
      errors?: string[];
      levelErrors?: string[];
      levelDraft?: Array<{
        level: number;
        xpThreshold: number;
        label: string | null;
        roleId: string | null;
      }>;
      fieldErrors?: Record<string, string[]>;
      notice?: string;
    },
  ) => {
    const [settings, levels, ledgerEntries, diagnostics, opts] = await Promise.all([
      shared.deps.prisma.rewardSettings.findUnique({ where: { guildId } }),
      shared.deps.prisma.rewardLevel.findMany({ where: { guildId }, orderBy: { level: 'asc' } }),
      shared.deps.prisma.rewardLedgerEntry.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { member: { include: { user: { select: { displayName: true } } } } },
      }),
      rewardDiagnostics.run(guildId),
      fetchOptions(guildId),
    ]);
    return rewardsPage({
      id: guildId,
      name: shared.guild(guildId)?.name ?? '',
      username: auth.discordUserId,
      csrf: auth.csrf,
      adjustmentId: shared.requestId(),
      settings: {
        version: settings?.version ?? null,
        enabled: settings?.enabled ?? false,
        textXpAmount: settings?.textXpAmount ?? 10,
        textCooldownSeconds: settings?.textCooldownSeconds ?? 60,
        voiceXpAmount: settings?.voiceXpAmount ?? 5,
        voiceIntervalSeconds: settings?.voiceIntervalSeconds ?? 300,
        textChannelIds: settings?.textChannelIds ?? [],
        voiceChannelIds: settings?.voiceChannelIds ?? [],
        tagRequiredSeconds: settings?.tagRequiredSeconds ?? 2592000,
        tagRewardRoleId: settings?.tagRewardRoleId ?? '',
        tagReconcileSeconds: settings?.tagReconcileSeconds ?? 900,
      },
      levels: options?.levelDraft ?? levels.map((level) => ({ ...level })),
      textChannels: opts.textChannels,
      voiceChannels: opts.voiceChannels,
      roles: opts.roles,
      members: opts.members,
      ledgerEntries: ledgerEntries.map((entry) => ({
        member: entry.member.user.displayName,
        amount: entry.amount,
        source: entry.source,
        actorDiscordUserId: entry.actorDiscordUserId,
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
      diagnostics,
      inDevelopment: true,
      releaseVariant: 'in-development',
      ...(options?.errors === undefined ? {} : { errors: options.errors }),
      ...(options?.levelErrors === undefined ? {} : { levelErrors: options.levelErrors }),
      ...(options?.fieldErrors === undefined ? {} : { fieldErrors: options.fieldErrors }),
      ...(options?.notice === undefined ? {} : { notice: options.notice }),
    });
  };

  app.get(
    '/admin/guilds/:guildId/rewards',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticate(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const html = await buildRewardsPage(params.data.guildId, auth);
      return reply.type('text/html').send(html);
    },
  );

  app.post(
    '/admin/guilds/:guildId/rewards/settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      if (!isProductionReady('rewards'))
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Rewards is not production-ready.',
          403,
        );
      const body = rewardSettingsSchema.safeParse(request.body);
      if (!body.success) {
        const html = await buildRewardsPage(params.data.guildId, auth, {
          errors: ['Review the fields and try again.'],
          fieldErrors: {},
        });
        return reply.code(400).type('text/html').send(html);
      }
      const current = await shared.deps.prisma.rewardSettings.findUnique({
        where: { guildId: params.data.guildId },
      });
      if (
        (body.data.version === 'new') !== (current === null) ||
        (typeof body.data.version === 'number' && body.data.version !== current?.version)
      )
        return shared.staleReply(reply, `/admin/guilds/${params.data.guildId}/rewards`);
      try {
        const currentLevels = await shared.deps.prisma.rewardLevel.findMany({
          where: { guildId: params.data.guildId },
          orderBy: { level: 'asc' },
        });
        await rewardSettings.update({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          textXpAmount: body.data.textXpAmount,
          textCooldownSeconds: body.data.textCooldownSeconds,
          voiceXpAmount: body.data.voiceXpAmount,
          voiceIntervalSeconds: body.data.voiceIntervalSeconds,
          textChannelIds: body.data.textChannelIds,
          voiceChannelIds: body.data.voiceChannelIds,
          tagRequiredSeconds: body.data.tagRequiredSeconds,
          ...(body.data.tagRewardRoleId === ''
            ? {}
            : { tagRewardRoleId: body.data.tagRewardRoleId }),
          tagReconcileSeconds: body.data.tagReconcileSeconds,
          levels: currentLevels.map((level) => ({
            level: level.level,
            xpThreshold: level.xpThreshold,
            ...(level.label === null ? {} : { label: level.label }),
            ...(level.roleId === null ? {} : { roleId: level.roleId }),
          })),
          expectedVersion: body.data.version === 'new' ? null : body.data.version,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not save reward settings.';
        const html = await buildRewardsPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/rewards/enable',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      if (!isProductionReady('rewards'))
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Rewards is not production-ready.',
          403,
        );
      const body = rewardToggleSchema.safeParse(request.body);
      if (!body.success)
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Invalid request.',
        );
      await rewardSettings.setEnabled(
        params.data.guildId,
        true,
        auth.discordUserId,
        shared.requestId(),
        body.data.version,
      );
      return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/rewards/disable',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      if (!isProductionReady('rewards'))
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Rewards is not production-ready.',
          403,
        );
      const body = rewardToggleSchema.safeParse(request.body);
      if (!body.success)
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Invalid request.',
        );
      await rewardSettings.setEnabled(
        params.data.guildId,
        false,
        auth.discordUserId,
        shared.requestId(),
        body.data.version,
      );
      return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
    },
  );

  app.post(
    '/admin/guilds/:guildId/rewards/adjust',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      if (!isProductionReady('rewards'))
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Rewards is not production-ready.',
          403,
        );
      const body = rewardAdjustmentSchema.safeParse(request.body);
      if (!body.success) {
        const html = await buildRewardsPage(params.data.guildId, auth, {
          errors: ['Invalid adjustment.'],
        });
        return reply.code(400).type('text/html').send(html);
      }
      const discordGuild = await shared.deps.discord.guilds.fetch(params.data.guildId);
      const member = await discordGuild.members.fetch(body.data.discordUserId);
      await rewards.award({
        guildId: params.data.guildId,
        discordUserId: body.data.discordUserId,
        displayName: member.displayName || member.user.username,
        amount: body.data.amount,
        source: 'ADMIN_ADJUSTMENT',
        actorDiscordUserId: auth.discordUserId,
        reason: body.data.reason,
        idempotencyKey: body.data.adjustmentId,
        correlationId: body.data.adjustmentId,
      });
      return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
    },
  );

  // Levels add/remove/save
  app.post(
    '/admin/guilds/:guildId/rewards/levels/add',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const parsed = rewardLevelsSchema.safeParse(request.body);
      const draft = parsed.success ? parseRewardLevels(parsed.data) : [];
      draft.push({ level: draft.length + 1, xpThreshold: 0, label: null, roleId: null });
      const html = await buildRewardsPage(params.data.guildId, auth, { levelDraft: draft });
      return reply.type('text/html').send(html);
    },
  );

  app.post(
    '/admin/guilds/:guildId/rewards/levels/remove/:index',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z
        .object({ guildId: idSchema, index: z.coerce.number().int().min(0) })
        .safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      const parsed = rewardLevelsSchema.safeParse(request.body);
      const draft = parsed.success ? parseRewardLevels(parsed.data) : [];
      draft.splice(params.data.index, 1);
      const html = await buildRewardsPage(params.data.guildId, auth, { levelDraft: draft });
      return reply.type('text/html').send(html);
    },
  );

  app.post(
    '/admin/guilds/:guildId/rewards/levels/save',
    async (request: FastifyRequest, reply: FastifyReply) => {
      shared.headers(reply);
      const auth = await shared.authenticatePost(request, reply);
      if (auth === null) return;
      const params = z.object({ guildId: idSchema }).safeParse(request.params);
      if (!params.success || shared.guild(params.data.guildId) === undefined)
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      if (!isProductionReady('rewards'))
        return shared.renderError(
          reply,
          `/admin/guilds/${params.data.guildId}/rewards`,
          'Rewards is not production-ready.',
          403,
        );
      const body = rewardLevelsSchema.safeParse(request.body);
      if (!body.success) {
        const html = await buildRewardsPage(params.data.guildId, auth, {
          errors: ['Invalid level input.'],
        });
        return reply.code(400).type('text/html').send(html);
      }
      const current = await shared.deps.prisma.rewardSettings.findUnique({
        where: { guildId: params.data.guildId },
      });
      const isNew = body.data.version === 'new';
      if (isNew ? current !== null : current === null || body.data.version !== current.version)
        return shared.staleReply(reply, `/admin/guilds/${params.data.guildId}/rewards`);
      const defaults = {
        textXpAmount: 10,
        textCooldownSeconds: 60,
        voiceXpAmount: 5,
        voiceIntervalSeconds: 300,
        textChannelIds: [] as string[],
        voiceChannelIds: [] as string[],
        tagRequiredSeconds: 2_592_000,
        tagRewardRoleId: undefined as string | undefined,
        tagReconcileSeconds: 900,
      };
      const settings = current ?? defaults;
      try {
        const levels = parseRewardLevels(body.data);
        await rewardSettings.update({
          guildId: params.data.guildId,
          actorDiscordUserId: auth.discordUserId,
          correlationId: shared.requestId(),
          textXpAmount: settings.textXpAmount,
          textCooldownSeconds: settings.textCooldownSeconds,
          voiceXpAmount: settings.voiceXpAmount,
          voiceIntervalSeconds: settings.voiceIntervalSeconds,
          textChannelIds: settings.textChannelIds,
          voiceChannelIds: settings.voiceChannelIds,
          tagRequiredSeconds: settings.tagRequiredSeconds,
          ...(settings.tagRewardRoleId ? { tagRewardRoleId: settings.tagRewardRoleId } : {}),
          tagReconcileSeconds: settings.tagReconcileSeconds,
          levels: levels.map((level) => ({
            level: level.level,
            xpThreshold: level.xpThreshold,
            ...(level.label === null || level.label.length === 0 ? {} : { label: level.label }),
            ...(level.roleId === null || level.roleId.length === 0 ? {} : { roleId: level.roleId }),
          })),
          expectedVersion: body.data.version === 'new' ? null : body.data.version,
        });
      } catch (error: unknown) {
        const message =
          error instanceof PublicError ? error.publicMessage : 'Could not save levels.';
        const html = await buildRewardsPage(params.data.guildId, auth, { errors: [message] });
        return reply.code(400).type('text/html').send(html);
      }
      return reply.redirect(`/admin/guilds/${params.data.guildId}/rewards`, 303);
    },
  );
}

interface LevelDraft {
  level: number;
  xpThreshold: number;
  label: string | null;
  roleId: string | null;
}

function parseRewardLevels(data: z.infer<typeof rewardLevelsSchema>): LevelDraft[] {
  const levels: LevelDraft[] = [];
  const count = Math.max(
    data.levelNumbers.length,
    data.levelThresholds.length,
    data.levelLabels.length,
    data.levelRoleIds.length,
  );
  for (let index = 0; index < count; index++) {
    const level = Number(data.levelNumbers[index]);
    const xpThreshold = Number(data.levelThresholds[index]);
    if (Number.isNaN(level) || Number.isNaN(xpThreshold)) continue;
    const label = data.levelLabels[index]?.trim() ?? null;
    const roleId = data.levelRoleIds[index] ?? null;
    levels.push({
      level,
      xpThreshold,
      label: label !== null && label.length > 0 ? label : null,
      roleId: roleId !== null && roleId.length > 0 ? roleId : null,
    });
  }
  return levels;
}
