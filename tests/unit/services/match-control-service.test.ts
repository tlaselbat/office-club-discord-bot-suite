import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { MatchControlService } from '../../../src/modules/tenman/services/match-control-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import type { DatHostClient } from '../../../src/modules/tenman/integrations/dathost/client.js';

function createMockPrisma(matchOverrides: object = {}): PrismaClient {
  const match = {
    id: 'match-1',
    guildId: 'guild-1',
    state: 'LIVE',
    dathostServerId: 'server-1',
    ...matchOverrides,
  };
  return {
    match: { findUnique: vi.fn().mockResolvedValue(match) },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as PrismaClient;
}

function createMockDathost(): DatHostClient {
  return {
    sendConsole: vi.fn().mockResolvedValue(undefined),
  } as unknown as DatHostClient;
}

describe('MatchControlService', () => {
  it('sends force start and audits', async () => {
    const prisma = createMockPrisma();
    const dathost = createMockDathost();
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
    const service = new MatchControlService(prisma, dathost, logger);

    await service.forceStart('match-1', 'user-1', 'corr-1');

    expect(dathost.sendConsole).toHaveBeenCalledWith('server-1', 'css_start');
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchId: 'match-1',
          guildId: 'guild-1',
          actorDiscordUserId: 'user-1',
          eventType: 'match_control_executed',
          metadata: { command: 'css_start' },
        }),
      }),
    );
  });

  it('sends restore round and audits', async () => {
    const prisma = createMockPrisma();
    const dathost = createMockDathost();
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
    const service = new MatchControlService(prisma, dathost, logger);

    await service.restoreRound('match-1', 5, 'user-1', 'corr-1');

    expect(dathost.sendConsole).toHaveBeenCalledWith('server-1', 'css_restore 5');
  });

  it('throws when server is not provisioned', async () => {
    const prisma = createMockPrisma({ dathostServerId: null });
    const dathost = createMockDathost();
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
    const service = new MatchControlService(prisma, dathost, logger);

    await expect(service.forceStart('match-1', 'user-1', 'corr-1')).rejects.toThrow(
      'Server is not provisioned',
    );
  });
});
