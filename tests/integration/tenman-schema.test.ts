import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/database/prisma.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);

suite('10man schema', () => {
  const guildId = `migration-test-${randomUUID()}`;

  beforeAll(async () => {
    await prisma?.$connect();
  });

  afterAll(async () => {
    await prisma?.guildSettings.delete({ where: { guildId } }).catch(() => undefined);
    await prisma?.$disconnect();
  });

  it('supports suite-guild, settings, and durable queue relations', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');

    await prisma.guildSettings.create({
      data: { guildId, tenManSettings: { create: {} } },
    });
    const queue = await prisma.tenManQueue.create({
      data: { guildId },
      include: { guild: { include: { suite: true } } },
    });

    expect(queue.status).toBe('OPEN');
    expect(queue.guild.suite.guildId).toBe(guildId);
  });
});
