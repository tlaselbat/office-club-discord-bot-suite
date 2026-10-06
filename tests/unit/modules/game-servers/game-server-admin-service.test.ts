import { describe, expect, it, vi } from 'vitest';
import { GameServerAdminService } from '../../../../src/modules/game-servers/services/game-server-admin-service.js';

describe('GameServerAdminService toggle CAS', () => {
  it('rejects a lost CAS without writing a success audit', async () => {
    const tx = {
      gameServer: {
        findFirst: vi.fn().mockResolvedValue({ id: 'server-1', guildId: 'guild-1', version: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new GameServerAdminService({
      prisma,
      discord: {} as never,
      dathost: {} as never,
      panelService: {} as never,
      cardService: {} as never,
    });
    await expect(
      service.setServerEnabled({
        guildId: 'guild-1',
        gameServerId: 'server-1',
        expectedVersion: 2,
        enabled: false,
        actorDiscordUserId: 'user-1',
        correlationId: 'corr-1',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONFIGURATION' });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
