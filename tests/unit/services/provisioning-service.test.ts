import { describe, expect, it, vi } from 'vitest';
import { ProvisioningService } from '../../../src/modules/tenman/services/provisioning-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const matchId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createMockPrisma(): PrismaClient {
  const prisma = {
    match: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    matchStateTransition: { create: vi.fn().mockResolvedValue(undefined) },
    job: { create: vi.fn().mockResolvedValue(undefined) },
    provisioningAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (callback: (client: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
    ),
  } as unknown as PrismaClient;
  return prisma;
}

function createMatch(overrides: object = {}) {
  return {
    id: matchId,
    state: 'TEAMS_LOCKED',
    guildId: 'guild-1',
    selectedMap: 'de_dust2',
    selectedGameProfileKey: 'competitive_5v5',
    matchzyMatchId: 1,
    dathostServerId: null,
    guild: {
      dathostTemplateServerId: 'template-1',
      defaultServerLocation: 'dallas',
    },
    profile: {
      playersPerTeam: 5,
      serverSlots: 10,
      allowedCvars: {},
    },
    players: Array.from({ length: 10 }, (_, index) => ({
      discordUserId: `p${String(index + 1)}`,
      steamId64: `765611980000000${String(index + 1).padStart(2, '0')}`,
      team: index < 5 ? 'TEAM_1' : ('TEAM_2' as const),
      displayNameSnapshot: `Player ${String(index + 1)}`,
    })),
    ...overrides,
  };
}

function createMockOrchestrator(serverId: string) {
  return {
    provision: vi.fn().mockResolvedValue({ id: serverId }),
  };
}

function createMockDathost() {
  return {
    updateServer: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(undefined),
    getServer: vi.fn().mockResolvedValue({
      id: 'server-1',
      booting: false,
      ip: '192.0.2.1',
      ports: { game: 27015 },
    }),
    sendConsole: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCredentials() {
  return {
    issue: vi.fn().mockResolvedValue({ token: 'token-1234567890abcdef' }),
  };
}

function createMockCipher() {
  return {
    encrypt: vi.fn().mockReturnValue('encrypted-value'),
  };
}

describe('ProvisioningService', () => {
  it('runs the provision job from TEAMS_LOCKED to SERVER_BOOTING', async () => {
    const prisma = createMockPrisma();
    prisma.match.findUnique = vi.fn().mockResolvedValue(createMatch());
    const orchestrator = createMockOrchestrator('server-1');
    const dathost = createMockDathost();
    const credentials = createMockCredentials();
    const cipher = createMockCipher();
    const service = new ProvisioningService(
      prisma,
      orchestrator as unknown as ConstructorParameters<typeof ProvisioningService>[1],
      dathost as unknown as ConstructorParameters<typeof ProvisioningService>[2],
      credentials as unknown as ConstructorParameters<typeof ProvisioningService>[3],
      cipher as unknown as ConstructorParameters<typeof ProvisioningService>[4],
      new URL('https://example.com'),
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ConstructorParameters<
        typeof ProvisioningService
      >[6],
    );

    await service.runProvisionJob(matchId);

    expect(orchestrator.provision).toHaveBeenCalled();
    expect(dathost.updateServer).toHaveBeenCalledWith('server-1', expect.any(Object));
    expect(dathost.startServer).toHaveBeenCalledWith('server-1');
    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'POLL_SERVER_BOOT' }),
      }),
    );
  });

  it('runs the boot poll job from SERVER_BOOTING to MATCH_LOADED', async () => {
    const prisma = createMockPrisma();
    prisma.match.findUnique = vi
      .fn()
      .mockResolvedValue(createMatch({ state: 'SERVER_BOOTING', dathostServerId: 'server-1' }));
    const orchestrator = createMockOrchestrator('server-1');
    const dathost = createMockDathost();
    const credentials = createMockCredentials();
    const cipher = createMockCipher();
    const service = new ProvisioningService(
      prisma,
      orchestrator as unknown as ConstructorParameters<typeof ProvisioningService>[1],
      dathost as unknown as ConstructorParameters<typeof ProvisioningService>[2],
      credentials as unknown as ConstructorParameters<typeof ProvisioningService>[3],
      cipher as unknown as ConstructorParameters<typeof ProvisioningService>[4],
      new URL('https://example.com'),
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ConstructorParameters<
        typeof ProvisioningService
      >[6],
    );

    await service.runBootPollJob(matchId, 'server-1', Date.now());

    expect(dathost.sendConsole).toHaveBeenCalledWith(
      'server-1',
      expect.stringContaining('matchzy_loadmatch_url'),
    );
    expect(credentials.issue).toHaveBeenCalledTimes(2);
    expect(prisma.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'MATCH_LOADED' }),
      }),
    );
    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'VOICE_RECONCILE' }),
      }),
    );
  });
});
