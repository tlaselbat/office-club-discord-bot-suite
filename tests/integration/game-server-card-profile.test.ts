import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Client, type TextBasedChannel } from 'discord.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { GameServerCardService } from '../../src/modules/game-servers/card-service.js';
import { GameServerAdminService } from '../../src/modules/game-servers/services/game-server-admin-service.js';
import {
  cardProfileSchema,
  resolveCardProfile,
} from '../../src/modules/game-servers/card-profile.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);
const other = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);
const guildId = `card-profile-test-${randomUUID()}`;
const serverId = randomUUID();

suite('Game Server Card Profile persistence and publication', () => {
  beforeAll(async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    await prisma.guildSettings.create({ data: { guildId } });
    await prisma.gameServer.create({
      data: { id: serverId, guildId, providerServerId: randomUUID(), displayName: 'Profile test' },
    });
  });
  afterAll(async () => {
    const cards = await prisma?.gameServerCard.findMany({
      where: { gameServerId: serverId },
      select: { id: true },
    });
    for (const card of cards ?? [])
      await prisma?.job.deleteMany({ where: { payload: { path: ['cardId'], equals: card.id } } });
    await prisma?.guildSettings.delete({ where: { guildId } });
    await Promise.all([prisma?.$disconnect(), other?.$disconnect()]);
  });

  it('persists a saved profile and reloads it from an independent client', async () => {
    if (prisma === null || other === null) throw new Error('TEST_DATABASE_URL required');
    const profile = cardProfileSchema.parse({
      accentColor: '#123456',
      onlineEmojiId: '22345678901234567',
    });
    const admin = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      cardService: {} as never,
    });
    await admin.updateServer({
      guildId,
      gameServerId: serverId,
      actorDiscordUserId: 'test-owner',
      correlationId: randomUUID(),
      expectedVersion: 0,
      cardProfile: profile,
    });
    const saved = await other.gameServer.findUniqueOrThrow({ where: { id: serverId } });
    expect(saved.version).toBe(1);
    expect(resolveCardProfile(saved.cardProfile)).toMatchObject({
      accentColor: '#123456',
      onlineEmojiId: '22345678901234567',
    });
  });

  it('publishes one message for simultaneous requests from independent clients', async () => {
    if (prisma === null || other === null) throw new Error('TEST_DATABASE_URL required');
    const message = {
      id: '42345678901234567',
      author: { id: 'bot' },
      edit: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const channel = {
      id: '32345678901234567',
      isTextBased: () => true,
      isDMBased: () => false,
      send: vi.fn().mockResolvedValue(message),
      messages: { fetch: vi.fn().mockResolvedValue(message) },
    };
    const discord = {
      user: { id: 'bot' },
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
    } as unknown as Client;
    const a = new GameServerCardService(prisma, discord, 'test-secret');
    const b = new GameServerCardService(other, discord, 'test-secret');
    const [first, second] = await Promise.all([
      a.publishDeployment(serverId, channel as unknown as TextBasedChannel),
      b.publishDeployment(serverId, channel as unknown as TextBasedChannel),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.messageId).toBe(message.id);
    expect(channel.send).toHaveBeenCalledOnce();
    expect(await prisma.gameServerCard.count({ where: { gameServerId: serverId } })).toBe(1);
  });
});
