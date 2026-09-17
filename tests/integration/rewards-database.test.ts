import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/database/prisma.js';
import { RewardService } from '../../src/modules/rewards/services/reward-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);

suite('rewards database concurrency', () => {
  const guildId = `test-${randomUUID()}`;
  const discordUserId = `test-${randomUUID()}`;

  beforeAll(async () => {
    await prisma?.$connect();
    await prisma?.guildSettings.create({ data: { guildId } });
    await prisma?.rewardSettings.create({ data: { guildId, enabled: true } });
  });

  afterAll(async () => {
    await prisma?.guildSettings.delete({ where: { guildId } });
    await prisma?.user.deleteMany({ where: { discordUserId } });
    await prisma?.$disconnect();
  });

  it('serializes concurrent awards without losing XP', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const rewards = new RewardService(prisma);
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        rewards.award({
          guildId,
          discordUserId,
          displayName: 'Concurrent Member',
          amount: 5,
          source: 'VOICE_ACTIVITY',
          idempotencyKey: `concurrency:${String(index)}`,
        }),
      ),
    );
    const member = await prisma.rewardMember.findUniqueOrThrow({
      where: { guildId_discordUserId: { guildId, discordUserId } },
    });
    expect(member.effectiveXp).toBe(50);
  });

  it('deduplicates simultaneous delivery of one activity key', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const rewards = new RewardService(prisma);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        rewards.award({
          guildId,
          discordUserId,
          displayName: 'Concurrent Member',
          amount: 5,
          source: 'VOICE_ACTIVITY',
          idempotencyKey: 'concurrency:duplicate',
        }),
      ),
    );
    expect(results.filter((result) => result.applied)).toHaveLength(1);
  });
});
