import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/database/prisma.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);

suite('10man database invariants', () => {
  const fixtureId = randomUUID();
  const guildId = `invariants-${fixtureId}`;
  const profileKey = `invariants-${fixtureId}`;
  const userIds = Array.from(
    { length: 5 },
    (_, index) => `invariants-${fixtureId}-${index.toString()}`,
  );
  const [firstUserId, , thirdUserId, fourthUserId, fifthUserId] = userIds;
  if (
    firstUserId === undefined ||
    thirdUserId === undefined ||
    fourthUserId === undefined ||
    fifthUserId === undefined
  ) {
    throw new Error('Expected five invariant-test users');
  }
  const steamId = () => {
    const suffix = randomInt(10_000_000_000).toString().padStart(10, '0');
    return '7656119' + suffix;
  };
  const identity = (discordUserId: string, steamId64 = steamId()) => ({
    discordUserId,
    steamId64,
    assignmentSource: 'DATABASE_INVARIANT_TEST',
    provenance: 'DATABASE_INVARIANT_TEST',
  });

  beforeAll(async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    await prisma.$connect();
    await prisma.user.createMany({
      data: userIds.map((discordUserId) => ({ discordUserId, displayName: 'Invariant test' })),
    });
    await prisma.guildSettings.create({ data: { guildId, tenManSettings: { create: {} } } });
    await prisma.gameProfile.create({
      data: {
        key: profileKey,
        playersPerTeam: 5,
        serverSlots: 11,
        mapAllowlist: ['de_mirage'],
        matchzyOptions: {},
        allowedCvars: {},
      },
    });
  });

  afterAll(async () => {
    if (prisma === null) return;
    try {
      await prisma.match.deleteMany({ where: { guildId } });
      await prisma.guildSettings.deleteMany({ where: { guildId } });
      await prisma.gameProfile.deleteMany({ where: { key: profileKey } });
      await prisma.steamIdentity.deleteMany({ where: { discordUserId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { discordUserId: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('allows only one concurrent active owner of a Steam identity', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const sharedSteamId = steamId();
    const results = await Promise.allSettled(
      userIds
        .slice(0, 2)
        .map((userId) => prisma.steamIdentity.create({ data: identity(userId, sharedSteamId) })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'P2002' } },
    ]);
  });

  it('allows only one concurrent active Steam identity per Discord user', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const userId = thirdUserId;
    const results = await Promise.allSettled([
      prisma.steamIdentity.create({ data: identity(userId) }),
      prisma.steamIdentity.create({ data: identity(userId) }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'P2002' } },
    ]);
  });

  it('retains invalidated identity history and permits reassignment', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const data = identity(fourthUserId);
    const previous = await prisma.steamIdentity.create({ data });
    await prisma.steamIdentity.update({
      where: { id: previous.id },
      data: { invalidatedAt: new Date(), invalidationReason: 'TEST_RELINK' },
    });
    await prisma.steamIdentity.create({ data });
    expect(await prisma.steamIdentity.count({ where: { discordUserId: data.discordUserId } })).toBe(
      2,
    );
  });

  it('rejects malformed Steam64 values at the database boundary', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    await expect(
      prisma.steamIdentity.create({ data: identity(fifthUserId, 'not-a-steam-id') }),
    ).rejects.toThrow();
    const valid = await prisma.steamIdentity.create({ data: identity(fifthUserId) });
    expect(valid.steamId64).toMatch(/^7656119[0-9]{10}$/);
  });

  it('keeps one active match per guild while allowing history and slot reuse', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const data = {
      guildId,
      leaderDiscordUserId: firstUserId,
      selectedGameProfileKey: profileKey,
      settingsVersion: 0,
      readyTimeoutSeconds: 90,
      captainPolicy: 'RANDOM' as const,
      teamSelectionMode: 'CAPTAINS' as const,
      mapSelectionMode: 'CAPTAIN_VETO' as const,
      dathostTemplateServerId: 'template-server',
      serverLocation: 'dallas',
      mapAllowlist: ['de_mirage', 'de_inferno'],
    };
    const results = await Promise.allSettled([
      prisma.match.create({ data }),
      prisma.match.create({ data }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'P2002' } },
    ]);
    await prisma.match.updateMany({ where: { guildId }, data: { guildSlotActive: false } });
    await prisma.match.create({ data });
    const historical = await prisma.match.create({ data: { ...data, guildSlotActive: false } });
    await expect(
      prisma.match.update({ where: { id: historical.id }, data: { guildSlotActive: true } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.match.count({ where: { guildId, guildSlotActive: true } })).toBe(1);
    expect(await prisma.match.count({ where: { guildId, guildSlotActive: false } })).toBe(2);
  });
});
