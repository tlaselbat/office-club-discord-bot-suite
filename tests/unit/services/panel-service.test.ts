import { describe, expect, it, vi } from 'vitest';
import { PanelService } from '../../../src/modules/tenman/services/panel-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

function createMockPrisma(matchOverrides: object = {}): PrismaClient {
  const match = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    leaderDiscordUserId: 'leader-1',
    state: 'OPEN',
    cleanupStatus: 'NOT_REQUIRED',
    selectedMap: null,
    selectedGameProfileKey: 'competitive_5v5',
    version: 1,
    discordPanelChannelId: 'channel-1',
    discordPanelMessageId: 'message-1',
    players: [],
    profile: { mapAllowlist: ['de_dust2'] },
    ...matchOverrides,
  };
  return {
    match: {
      findUnique: vi.fn().mockResolvedValue(match),
      update: vi.fn().mockResolvedValue(undefined),
    },
    gameProfile: {
      findMany: vi.fn().mockResolvedValue([{ key: 'competitive_5v5' }]),
    },
  } as unknown as PrismaClient;
}

function createMockClient(
  messages: Record<
    string,
    { edit: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> }
  > = {},
) {
  return {
    channels: {
      fetch: vi.fn().mockImplementation(async (id: string) => {
        if (id !== 'channel-1') return null;
        return {
          id: 'channel-1',
          send: vi.fn().mockResolvedValue({ id: 'message-new' }),
          messages: {
            fetch: async (messageId: string) => {
              const message = messages[messageId];
              if (message === undefined) return null;
              return message;
            },
          },
        };
      }),
    },
  };
}

describe('PanelService', () => {
  it('publishes initial panel and stores ids', async () => {
    const prisma = createMockPrisma({ discordPanelChannelId: null, discordPanelMessageId: null });
    const client = createMockClient();
    const service = new PanelService(
      prisma,
      client as unknown as ConstructorParameters<typeof PanelService>[1],
      'secret',
    );

    const result = await service.publishInitialPanel('match-1', {
      id: 'channel-1',
      send: async () => ({ id: 'message-1' }),
    } as unknown as Parameters<typeof service.publishInitialPanel>[1]);

    expect(result.channelId).toBe('channel-1');
    expect(prisma.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'match-1' },
        data: expect.objectContaining({ discordPanelChannelId: 'channel-1' }),
      }),
    );
  });

  it('edits existing panel on refresh', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const prisma = createMockPrisma();
    const client = createMockClient({ 'message-1': { edit, fetch: vi.fn() } });
    const service = new PanelService(
      prisma,
      client as unknown as ConstructorParameters<typeof PanelService>[1],
      'secret',
    );

    await service.refresh('match-1');

    expect(edit).toHaveBeenCalled();
  });

  it('recreates panel if the message was deleted', async () => {
    const prisma = createMockPrisma();
    const client = createMockClient();
    const service = new PanelService(
      prisma,
      client as unknown as ConstructorParameters<typeof PanelService>[1],
      'secret',
    );

    await service.refresh('match-1');

    expect(prisma.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ discordPanelMessageId: 'message-new' }),
      }),
    );
  });

  it('clears components from existing panel', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const prisma = createMockPrisma();
    const client = createMockClient({ 'message-1': { edit, fetch: vi.fn() } });
    const service = new PanelService(
      prisma,
      client as unknown as ConstructorParameters<typeof PanelService>[1],
      'secret',
    );

    await service.clear('match-1');

    expect(edit).toHaveBeenCalledWith({ components: [] });
  });
});
