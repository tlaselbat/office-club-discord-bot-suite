import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { RewardSettingsService } from '../../../../src/modules/rewards/services/reward-settings-service.js';

const command = {
  guildId: 'guild-1',
  actorDiscordUserId: 'admin-1',
  correlationId: 'correlation-1',
  expectedVersion: null,
  textXpAmount: 10,
  textCooldownSeconds: 60,
  voiceXpAmount: 5,
  voiceIntervalSeconds: 300,
  textChannelIds: [],
  voiceChannelIds: [],
  tagRequiredSeconds: 3600,
  tagReconcileSeconds: 900,
  levels: [
    { level: 1, xpThreshold: 100 },
    { level: 2, xpThreshold: 250 },
  ],
};

describe('RewardSettingsService', () => {
  it('rejects level thresholds that do not increase', async () => {
    const service = new RewardSettingsService({} as PrismaClient, {} as Client);
    await expect(
      service.update({
        ...command,
        levels: [
          { level: 1, xpThreshold: 100 },
          { level: 2, xpThreshold: 100 },
        ],
      }),
    ).rejects.toThrow('strictly increasing');
  });

  it('closes active voice sessions when disabled', async () => {
    const transaction = {
      $executeRaw: vi.fn(),
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({ version: 3 }),
        update: vi.fn(),
      },
      rewardVoiceSession: { updateMany: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      rewardVoiceSession: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const service = new RewardSettingsService(prisma, {} as Client);

    await service.setEnabled('guild-1', false, 'admin-1', 'correlation-1', 3);

    expect(transaction.rewardVoiceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { guildId: 'guild-1', status: 'ACTIVE' } }),
    );
  });

  it('reconciles members already connected when enabled', async () => {
    const transaction = {
      $executeRaw: vi.fn(),
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue({ version: 2 }),
        update: vi.fn(),
      },
      rewardVoiceSession: { updateMany: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      rewardVoiceSession: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const discord = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({ voiceStates: { cache: new Map() } }),
      },
    } as unknown as Client;

    await new RewardSettingsService(prisma, discord).setEnabled(
      'guild-1',
      true,
      'admin-1',
      'correlation-1',
      2,
    );

    expect(prisma.rewardVoiceSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { guildId: 'guild-1', status: 'ACTIVE' } }),
    );
  });

  it('saves settings, replaces levels, and writes an audit event transactionally', async () => {
    const transaction = {
      $executeRaw: vi.fn(),
      rewardSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      rewardLevel: { deleteMany: vi.fn(), createMany: vi.fn() },
      job: { upsert: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      rewardVoiceSession: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const discord = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          channels: { fetch: vi.fn() },
          roles: { fetch: vi.fn() },
          members: { fetchMe: vi.fn().mockResolvedValue({ roles: { highest: { position: 10 } } }) },
          voiceStates: { cache: new Map() },
        }),
      },
    } as unknown as Client;

    await new RewardSettingsService(prisma, discord).update(command);

    expect(transaction.rewardSettings.upsert).toHaveBeenCalledOnce();
    expect(transaction.rewardLevel.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ level: 2 })]),
      }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledOnce();
  });
});
