import { describe, expect, it, vi } from 'vitest';
import { PlayerStatusService } from '../../../src/modules/tenman/services/player-status-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const guildId = 'guild-1';
const discordUserId = 'user-1';

function createPrisma(overrides: {
  steamIdentity?: { steamId64: string } | null;
  queueEntry?: { id: string } | null;
  queueEntries?: { discordUserId: string }[];
  activeMatch?: {
    id: string;
    state: string;
    phaseDeadlineAt?: Date | null;
    selectedMap?: string | null;
  } | null;
  queueSize?: number;
}) {
  return {
    prisma: {
      steamIdentity: { findFirst: vi.fn().mockResolvedValue(overrides.steamIdentity ?? null) },
      tenManQueueEntry: {
        findUnique: vi.fn().mockResolvedValue(overrides.queueEntry ?? null),
      },
      match: {
        findFirst: vi.fn().mockResolvedValue(overrides.activeMatch ?? null),
      },
      tenManQueue: {
        findUnique: vi.fn().mockResolvedValue({ entries: overrides.queueEntries ?? [] }),
      },
      tenManSettings: {
        findUnique: vi.fn().mockResolvedValue({ queueSize: overrides.queueSize ?? 10 }),
      },
    } as unknown as PrismaClient,
  };
}

describe('PlayerStatusService', () => {
  it('reports a new player', async () => {
    const { prisma } = createPrisma({});

    const status = await new PlayerStatusService(prisma).getStatus(guildId, discordUserId);

    expect(status).toEqual({ kind: 'NEW_PLAYER' });
  });

  it('reports ready to queue when Steam is assigned but not queued', async () => {
    const { prisma } = createPrisma({
      steamIdentity: { steamId64: '76561198000000001' },
      queueEntries: [{ discordUserId: 'other-user' }],
      queueSize: 10,
    });

    const status = await new PlayerStatusService(prisma).getStatus(guildId, discordUserId);

    expect(status).toEqual({ kind: 'READY_TO_QUEUE', queueSize: 10, playersInQueue: 1 });
  });

  it('reports queued position', async () => {
    const { prisma } = createPrisma({
      steamIdentity: { steamId64: '76561198000000001' },
      queueEntry: { id: 'entry-1' },
      queueEntries: [{ discordUserId: 'other-user' }, { discordUserId }],
      queueSize: 10,
    });

    const status = await new PlayerStatusService(prisma).getStatus(guildId, discordUserId);

    expect(status).toEqual({ kind: 'QUEUED', position: 2, playersInQueue: 2, queueSize: 10 });
  });

  it('reports a ready-check match', async () => {
    const deadline = new Date('2026-01-01T00:00:00Z');
    const { prisma } = createPrisma({
      activeMatch: { id: 'match-1', state: 'READY_CHECK', phaseDeadlineAt: deadline },
    });

    const status = await new PlayerStatusService(prisma).getStatus(guildId, discordUserId);

    expect(status).toEqual({
      kind: 'READY_CHECK',
      matchId: 'match-1',
      deadlineAt: deadline,
      ready: false,
    });
  });

  it('reports an active match', async () => {
    const { prisma } = createPrisma({
      activeMatch: { id: 'match-1', state: 'LIVE', selectedMap: 'de_mirage' },
    });

    const status = await new PlayerStatusService(prisma).getStatus(guildId, discordUserId);

    expect(status).toEqual({
      kind: 'MATCH_ACTIVE',
      matchId: 'match-1',
      state: 'LIVE',
      selectedMap: 'de_mirage',
    });
  });

  it('reports a terminal match', async () => {
    const { prisma } = createPrisma({
      activeMatch: { id: 'match-1', state: 'FINISHED', selectedMap: null },
    });

    const status = await new PlayerStatusService(prisma).getStatus(guildId, discordUserId);

    expect(status).toEqual({ kind: 'TERMINAL', matchId: 'match-1', state: 'FINISHED' });
  });
});
