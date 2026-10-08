import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../../src/generated/prisma/client.js';
import { GameServerDiagnosticsService } from '../../../../src/modules/game-servers/services/game-server-diagnostics-service.js';

const guildId = 'guild-1';

function serviceWith(servers: unknown[]) {
  const prisma = {
    gameServerSettings: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
    gameServer: { findMany: vi.fn().mockResolvedValue(servers), findUnique: vi.fn() },
  } as unknown as PrismaClient;
  return new GameServerDiagnosticsService(prisma, { getServer: vi.fn() } as never);
}

const baseServer = {
  id: 'server-1',
  displayName: 'Arena',
  enabled: true,
  public: true,
  snapshot: {
    hostingState: 'RUNNING',
    stale: false,
    consecutiveFailures: 0,
    lastSuccessfulAt: new Date('2026-10-05T00:00:00Z'),
    lastError: null,
  },
};

describe('GameServerDiagnosticsService', () => {
  it('reports the legacy enabled default without a saved settings row', async () => {
    const prisma = {
      gameServerSettings: { findUnique: vi.fn().mockResolvedValue(null) },
      gameServer: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const report = await new GameServerDiagnosticsService(prisma, {} as never).runPersisted(
      guildId,
    );
    expect(report.settings).toContainEqual({
      label: 'Module settings',
      ok: true,
      detail: 'Enabled by default',
    });
    expect(report.aggregate).toContainEqual({
      label: 'Module state',
      ok: true,
      detail: 'Enabled by default',
    });
  });
  it('reports each Discord deployment without treating a global panel as configuration', async () => {
    const service = serviceWith([
      {
        ...baseServer,
        cards: [
          {
            id: 'card-1',
            channelId: 'channel-a',
            messageId: 'message-a',
            state: 'HEALTHY',
            lastError: null,
          },
          {
            id: 'card-2',
            channelId: 'channel-b',
            messageId: null,
            state: 'MISSING',
            lastError: 'Managed Discord message is missing.',
          },
        ],
      },
    ]);

    const report = await service.runPersisted(guildId);
    const checks = report.servers[0]?.checks ?? [];

    expect(checks).toContainEqual({
      label: 'Discord display (channel-a)',
      ok: true,
      detail: 'Healthy',
    });
    expect(checks).toContainEqual({
      label: 'Discord display (channel-b)',
      ok: false,
      detail: 'Managed Discord message is missing.',
    });
    expect(report.settings.some((check) => check.label === 'Panel destination')).toBe(false);
  });

  it('does not report an unpublished public registration as a failed display', async () => {
    const service = serviceWith([{ ...baseServer, cards: [] }]);
    const report = await service.runPersisted(guildId);

    expect(report.servers[0]?.checks).toContainEqual({
      label: 'Discord displays',
      ok: true,
      detail: 'No displays are published.',
    });
  });
});
