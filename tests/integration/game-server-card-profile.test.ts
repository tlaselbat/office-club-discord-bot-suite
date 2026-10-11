import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Client, type TextBasedChannel } from 'discord.js';
import Fastify from 'fastify';
import { createPrismaClient } from '../../src/database/prisma.js';
import { registerGameServersRoutes } from '../../src/http/routes/admin/game-servers.js';
import type { SharedHelpers } from '../../src/http/routes/admin/shared.js';
import { GameServerCardService } from '../../src/modules/game-servers/card-service.js';
import { GameServerAdminService } from '../../src/modules/game-servers/services/game-server-admin-service.js';
import { resolveCardProfile } from '../../src/modules/game-servers/card-profile.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);
const other = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);
const guildId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 16))).padStart(
  17,
  '1',
);
const serverId = randomUUID();

suite('Game Server Card Profile persistence and publication', () => {
  beforeAll(async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    await prisma.guildSettings.create({ data: { guildId } });
    await prisma.gameServer.create({
      data: {
        id: serverId,
        guildId,
        providerServerId: randomUUID(),
        displayName: 'Profile test',
      },
    });
    await prisma.gameServerSettings.create({ data: { guildId, enabled: true } });
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
    const admin = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      cardService: {} as never,
    });
    const app = Fastify();
    const guild = {
      name: 'Database acceptance',
      channels: { fetch: vi.fn().mockResolvedValue(new Map()) },
      emojis: { fetch: vi.fn().mockResolvedValue(new Map()) },
    };
    const shared = {
      deps: { prisma, gameServerAdmin: admin },
      headers: (reply: unknown) => reply,
      authenticate: vi.fn().mockResolvedValue({ discordUserId: 'test-owner', csrf: 'test-csrf' }),
      authenticatePost: vi
        .fn()
        .mockResolvedValue({ discordUserId: 'test-owner', csrf: 'test-csrf' }),
      guild: vi.fn().mockReturnValue(guild),
      requestId: () => randomUUID(),
    };
    registerGameServersRoutes(app, shared as unknown as SharedHelpers);
    try {
      const layout = {
        version: 3,
        buttons: [],
        elements: [
          {
            id: '00000000-0000-4000-8000-000000000701',
            type: 'text',
            label: 'Acceptance text',
            template: 'Saved through the real route',
            visible: true,
            style: 'normal',
          },
        ],
      };
      const response = await app.inject({
        method: 'POST',
        url: `/admin/guilds/${guildId}/game-servers/${serverId}/edit`,
        payload: {
          csrf: 'test-csrf',
          version: '0',
          displayName: 'Profile test saved',
          sortOrder: '0',
          accentColor: '#123456',
          layoutVersion: '3',
          layoutJson: JSON.stringify(layout),
          showConnectButton: '',
          showMapRulesButton: '1',
          mapRulesButtonLabel: 'Rules',
        },
      });
      expect(response.statusCode, response.body).toBe(303);
      expect(response.headers.location).toContain('?saved=1#card-designer');
      const saved = await other.gameServer.findUniqueOrThrow({ where: { id: serverId } });
      expect(saved.version).toBe(1);
      expect(saved.displayName).toBe('Profile test saved');
      expect(resolveCardProfile(saved.cardProfile)).toMatchObject({
        accentColor: '#123456',
        buttons: { connect: false, mapRules: true, mapRulesLabel: 'Rules' },
        layout: { version: 3, elements: [{ template: 'Saved through the real route' }] },
      });
      const reloadedPage = await app.inject({
        method: 'GET',
        url: `/admin/guilds/${guildId}/game-servers/${serverId}/edit`,
      });
      expect(reloadedPage.statusCode).toBe(200);
      expect(reloadedPage.body).toContain('Saved through the real route');

      const save = (version: string, body: Record<string, string>) =>
        app.inject({
          method: 'POST',
          url: `/admin/guilds/${guildId}/game-servers/${serverId}/edit`,
          payload: {
            csrf: 'test-csrf',
            version,
            displayName: 'Profile test saved',
            sortOrder: '0',
            accentColor: '#123456',
            layoutVersion: '3',
            layoutJson: JSON.stringify(layout),
            ...body,
          },
        });
      const secondSave = await save('1', {
        showConnectButton: '1',
        showMapRulesButton: '',
      });
      expect(secondSave.statusCode).toBe(303);
      const afterSecondSave = await other.gameServer.findUniqueOrThrow({
        where: { id: serverId },
      });
      expect(afterSecondSave.version).toBe(2);
      expect(resolveCardProfile(afterSecondSave.cardProfile).buttons).toMatchObject({
        connect: true,
        mapRules: false,
      });
      const invalidLayout = {
        version: 3,
        buttons: [],
        elements: Array.from({ length: 11 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index + 710).padStart(12, '0')}`,
          type: 'text',
          label: `Invalid child ${String(index)}`,
          template: `Draft retained ${String(index)}`,
          visible: true,
          style: 'normal',
        })),
      };
      const rejected = await save('2', {
        layoutJson: JSON.stringify(invalidLayout),
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.body).toContain('Draft retained 0');
      expect(rejected.body).toContain('at most 10');
      const afterRejectedSave = await other.gameServer.findUniqueOrThrow({
        where: { id: serverId },
      });
      expect(afterRejectedSave.version).toBe(2);
      expect(afterRejectedSave.cardProfile).toEqual(afterSecondSave.cardProfile);
      const conflict = await save('1', { showConnectButton: '', showMapRulesButton: '1' });
      expect(conflict.statusCode).toBe(409);
      const afterConflict = await other.gameServer.findUniqueOrThrow({
        where: { id: serverId },
      });
      expect(afterConflict.version).toBe(2);
      expect(afterConflict.cardProfile).toEqual(afterSecondSave.cardProfile);
    } finally {
      await app.close();
    }
  });

  it('publishes one message for simultaneous requests from independent clients', async () => {
    if (prisma === null || other === null) throw new Error('TEST_DATABASE_URL required');
    await prisma.gameServer.update({
      where: { id: serverId },
      data: { enabled: true, public: true },
    });
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
    const reconciled = await a.publishDeployment(serverId, channel as unknown as TextBasedChannel);
    expect(reconciled.id).toBe(first.id);
    expect(reconciled.messageId).toBe(first.messageId);
    expect(message.edit).toHaveBeenCalledTimes(2);
    expect(channel.send).toHaveBeenCalledOnce();
  });
});
