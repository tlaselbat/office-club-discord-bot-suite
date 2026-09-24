import { describe, expect, it, vi } from 'vitest';
import { QueueAlertService } from '../../../src/modules/tenman/services/queue-alert-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import type { Client, User } from 'discord.js';

function createMocks() {
  const queue: { lastQueueAlertCount: number } = { lastQueueAlertCount: 0 };
  const preferences: { guildId: string; discordUserId: string; queueAlert: boolean }[] = [];
  const sent: { discordUserId: string; message: string }[] = [];
  const prisma = {
    tenManNotificationPreference: {
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: (typeof preferences)[0];
          update: Partial<(typeof preferences)[0]>;
        }) => {
          const existing = preferences.find(
            (p) => p.guildId === create.guildId && p.discordUserId === create.discordUserId,
          );
          if (existing !== undefined) {
            Object.assign(existing, update);
          } else {
            preferences.push({ ...create, ...update });
          }
        },
      ),
      findMany: vi.fn(async () => preferences.filter((p) => p.queueAlert)),
    },
    tenManQueue: {
      findUnique: vi.fn(async () => queue),
      update: vi.fn(async ({ data }: { data: { lastQueueAlertCount: number } }) => {
        queue.lastQueueAlertCount = data.lastQueueAlertCount;
      }),
    },
    $transaction: vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
    ),
  } as unknown as PrismaClient;
  const discord = {
    users: {
      fetch: vi.fn(async (id: string) => {
        const user = {
          id,
          send: vi.fn(async (message: string) => {
            sent.push({ discordUserId: id, message });
          }),
        } as unknown as User;
        return user;
      }),
    },
  } as unknown as Client;
  return { prisma, discord, preferences, sent, queue };
}

describe('QueueAlertService', () => {
  it('sets a preference', async () => {
    const { prisma, discord } = createMocks();
    const service = new QueueAlertService(prisma, discord);
    await service.setPreference('guild-1', 'user-1', true);
    expect(prisma.tenManNotificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guildId_discordUserId: { guildId: 'guild-1', discordUserId: 'user-1' } },
        update: { queueAlert: true },
        create: { guildId: 'guild-1', discordUserId: 'user-1', queueAlert: true },
      }),
    );
  });

  it('sends DM alerts when the queue reaches an upward threshold', async () => {
    const { prisma, discord, preferences, sent } = createMocks();
    preferences.push({ guildId: 'guild-1', discordUserId: 'user-1', queueAlert: true });
    const service = new QueueAlertService(prisma, discord);
    await service.maybeSendQueueAlert('guild-1', 8, 10);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toContain('8/10');
  });

  it('does not alert below the threshold', async () => {
    const { prisma, discord, preferences, sent } = createMocks();
    preferences.push({ guildId: 'guild-1', discordUserId: 'user-1', queueAlert: true });
    const service = new QueueAlertService(prisma, discord);
    await service.maybeSendQueueAlert('guild-1', 7, 10);
    expect(sent).toHaveLength(0);
  });

  it('does not resend for the same or lower count', async () => {
    const { prisma, discord, preferences, sent, queue } = createMocks();
    preferences.push({ guildId: 'guild-1', discordUserId: 'user-1', queueAlert: true });
    queue.lastQueueAlertCount = 8;
    const service = new QueueAlertService(prisma, discord);
    await service.maybeSendQueueAlert('guild-1', 8, 10);
    expect(sent).toHaveLength(0);
  });

  it('ignores DM delivery failures', async () => {
    const { prisma, discord, preferences, sent } = createMocks();
    preferences.push({ guildId: 'guild-1', discordUserId: 'user-1', queueAlert: true });
    discord.users.fetch = vi.fn(async () => {
      const user = {
        send: vi.fn(async () => {
          throw new Error('DM closed');
        }),
      } as unknown as User;
      return user;
    });
    const service = new QueueAlertService(prisma, discord);
    await expect(service.maybeSendQueueAlert('guild-1', 8, 10)).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});
