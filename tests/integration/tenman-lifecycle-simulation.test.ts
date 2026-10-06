import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/database/prisma.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaProvisioningRepository } from '../../src/modules/tenman/database/provisioning-repository.js';
import { createJobHandlers } from '../../src/modules/tenman/jobs/handlers.js';
import { CaptainService } from '../../src/modules/tenman/services/captain-service.js';
import { CredentialCipher } from '../../src/modules/tenman/services/credential-cipher.js';
import { DraftService } from '../../src/modules/tenman/services/draft-service.js';
import { MatchCredentialService } from '../../src/modules/tenman/services/match-credential-service.js';
import { ProvisioningService } from '../../src/modules/tenman/services/provisioning-service.js';
import { QueueService } from '../../src/modules/tenman/services/queue-service.js';
import { ReadyCheckService } from '../../src/modules/tenman/services/ready-check-service.js';
import { VetoService } from '../../src/modules/tenman/services/veto-service.js';
import { MatchZyEventService } from '../../src/modules/tenman/services/matchzy-event-service.js';
import { ProvisioningOrchestrator } from '../../src/modules/tenman/orchestrator/provisioning.js';
import type { DatHostClient } from '../../src/modules/tenman/integrations/dathost/client.js';
import type { DatHostServer } from '../../src/modules/tenman/integrations/dathost/schemas.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(databaseUrl === undefined);
const prisma = databaseUrl === undefined ? null : createPrismaClient(databaseUrl);

/**
 * An executable beta gate: durable PostgreSQL state is used for every player-facing
 * transition, while DatHost is simulated so CI never creates a real server.
 * Real-provider acceptance remains deliberately opt-in in docs/staging-checklist.md.
 */
suite('10man ten-player lifecycle simulation', () => {
  const fixtureId = randomUUID();
  const guildId = `lifecycle-${fixtureId}`;
  const users = Array.from({ length: 10 }, (_, index) => ({
    discordUserId: `lifecycle-${fixtureId}-${String(index + 1)}`,
    displayName: `Simulated Player ${String(index + 1)}`,
    steamId64: `7656119${String(8_000_000_000 + index)}`,
  }));
  const profileKey = 'competitive_5v5';
  const maps = ['de_mirage', 'de_inferno', 'de_nuke'];
  let matchId = '';
  let originalProfile: {
    enabled: boolean;
    playersPerTeam: number;
    numMaps: number;
    serverSlots: number;
    mapAllowlist: string[];
    matchzyOptions: Prisma.JsonValue;
    allowedCvars: Prisma.JsonValue;
  } | null = null;
  const fakeDatHost = new SimulatedDatHost();

  beforeAll(async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    await prisma.$connect();
    await prisma.user.createMany({
      data: users.map(({ discordUserId, displayName }) => ({ discordUserId, displayName })),
    });
    await prisma.steamIdentity.createMany({
      data: users.map(({ discordUserId, steamId64 }) => ({
        discordUserId,
        steamId64,
        assignmentSource: 'LIFECYCLE_SIMULATION',
        provenance: 'LIFECYCLE_SIMULATION',
      })),
    });
    originalProfile = await prisma.gameProfile.findUnique({
      where: { key: profileKey },
      select: {
        enabled: true,
        playersPerTeam: true,
        numMaps: true,
        serverSlots: true,
        mapAllowlist: true,
        matchzyOptions: true,
        allowedCvars: true,
      },
    });
    await prisma.gameProfile.upsert({
      where: { key: profileKey },
      update: {
        enabled: true,
        playersPerTeam: 5,
        numMaps: 1,
        serverSlots: 11,
        mapAllowlist: maps,
        matchzyOptions: { minPlayersToReady: 10, knifeRound: true, mapSide: 'knife' },
        allowedCvars: {},
      },
      create: {
        key: profileKey,
        enabled: true,
        playersPerTeam: 5,
        numMaps: 1,
        serverSlots: 11,
        mapAllowlist: maps,
        matchzyOptions: { minPlayersToReady: 10, knifeRound: true, mapSide: 'knife' },
        allowedCvars: {},
      },
    });
    await prisma.guildSettings.create({
      data: {
        guildId,
        tenManSettings: {
          create: {
            enabled: true,
            defaultGameProfileKey: profileKey,
            dathostTemplateServerId: 'simulation-template',
            defaultServerLocation: 'dallas',
            queueSize: 10,
            readyTimeoutSeconds: 90,
            captainPolicy: 'RANDOM',
            teamSelectionMode: 'CAPTAINS',
            mapSelectionMode: 'CAPTAIN_VETO',
            activeMapPool: maps,
            privilegedRoleIds: [],
            moderatorRoleIds: [],
            administratorRoleIds: [],
          },
        },
      },
    });
    await prisma.tenManQueue.create({ data: { guildId, status: 'OPEN' } });
  });

  afterAll(async () => {
    if (prisma === null) return;
    try {
      await prisma.match.deleteMany({ where: { guildId } });
      await prisma.guildSettings.deleteMany({ where: { guildId } });
      if (originalProfile === null) {
        await prisma.gameProfile.deleteMany({ where: { key: profileKey } });
      } else {
        await prisma.gameProfile.update({
          where: { key: profileKey },
          data: {
            ...originalProfile,
            matchzyOptions: originalProfile.matchzyOptions as Prisma.InputJsonValue,
            allowedCvars: originalProfile.allowedCvars as Prisma.InputJsonValue,
          },
        });
      }
      await prisma.steamIdentity.deleteMany({
        where: { discordUserId: { in: users.map((user) => user.discordUserId) } },
      });
      await prisma.user.deleteMany({
        where: { discordUserId: { in: users.map((user) => user.discordUserId) } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('promotes ten simulated players exactly once and completes draft, veto, and simulated deployment', async () => {
    if (prisma === null) throw new Error('TEST_DATABASE_URL required');
    const queue = new QueueService(prisma);

    for (const [index, user] of users.slice(0, 8).entries()) {
      const result = await queue.join({
        guildId,
        discordUserId: user.discordUserId,
        displayName: user.displayName,
        correlationId: `simulation-queue-${String(index)}`,
      });
      expect(result.status).toBe('joined');
    }
    const finalResults = await Promise.all(
      users.slice(8).map((user, index) =>
        queue.join({
          guildId,
          discordUserId: user.discordUserId,
          displayName: user.displayName,
          correlationId: `simulation-concurrent-final-join-${String(index)}`,
        }),
      ),
    );
    expect(finalResults.map((result) => result.status)).toEqual(['joined', 'joined']);
    const promotions = finalResults.flatMap((result) =>
      result.status === 'joined' && result.promotedMatchId !== undefined
        ? [result.promotedMatchId]
        : [],
    );
    expect(promotions).toHaveLength(1);
    matchId = promotions[0] as string;

    expect(await prisma.match.count({ where: { guildId, state: 'READY_CHECK' } })).toBe(1);
    expect(await prisma.tenManQueueEntry.count({ where: { guildId } })).toBe(0);
    expect(await prisma.tenManQueue.findUnique({ where: { guildId } })).toMatchObject({
      status: 'LOCKED',
    });
    expect(
      await prisma.job.count({
        where: {
          matchId,
          type: 'MATCH_PHASE_TIMEOUT',
          idempotencyKey: `phase-timeout:${matchId}:READY_CHECK:0`,
        },
      }),
    ).toBe(1);

    const ready = new ReadyCheckService(prisma);
    for (const [index, user] of users.entries()) {
      const match = await requiredMatch(prisma, matchId);
      await ready.setReady(
        matchId,
        user.discordUserId,
        match.version,
        true,
        `simulation-ready-${String(index)}`,
      );
    }
    expect(await requiredMatch(prisma, matchId)).toMatchObject({ state: 'TEAM_SELECTION' });

    const captains = new CaptainService(prisma);
    let match = await requiredMatch(prisma, matchId);
    await captains.selectRandom(matchId, match.version, 'simulation-captains');
    match = await requiredMatch(prisma, matchId);
    const captainByTeam = new Map(
      match.players
        .filter((player) => player.captainTeam !== null)
        .map((player) => [player.captainTeam as 'TEAM_1' | 'TEAM_2', player.discordUserId]),
    );
    expect(captainByTeam.size).toBe(2);

    const draft = new DraftService(prisma);
    const draftTeams = [
      'TEAM_1',
      'TEAM_2',
      'TEAM_2',
      'TEAM_1',
      'TEAM_1',
      'TEAM_2',
      'TEAM_2',
      'TEAM_1',
    ] as const;
    for (const [index, team] of draftTeams.entries()) {
      match = await requiredMatch(prisma, matchId);
      const player = match.players.find((candidate) => candidate.team === 'UNASSIGNED');
      const captain = captainByTeam.get(team);
      if (player === undefined || captain === undefined)
        throw new Error('Simulation draft setup failed');
      await draft.pick(
        matchId,
        captain,
        player.discordUserId,
        match.version,
        `simulation-draft-${String(index)}`,
      );
    }

    match = await requiredMatch(prisma, matchId);
    expect(match.state).toBe('MAP_VETO');
    const veto = new VetoService(prisma);
    for (const [index, map] of maps.slice(0, -1).entries()) {
      match = await requiredMatch(prisma, matchId);
      const team = index % 2 === 0 ? 'TEAM_1' : 'TEAM_2';
      const captain = captainByTeam.get(team);
      if (captain === undefined) throw new Error('Simulation veto setup failed');
      await veto.ban(matchId, captain, map, match.version, `simulation-veto-${String(index)}`);
    }
    expect(await requiredMatch(prisma, matchId)).toMatchObject({
      state: 'TEAMS_LOCKED',
      selectedMap: maps[2],
    });

    const provisioning = new ProvisioningService(
      prisma,
      new ProvisioningOrchestrator(
        new PrismaProvisioningRepository(prisma),
        fakeDatHost,
        new Set(['simulation-template']),
      ),
      fakeDatHost as unknown as DatHostClient,
      new MatchCredentialService(prisma),
      new CredentialCipher(randomBytes(32).toString('base64')),
      new URL('https://staging.invalid'),
      { info() {}, warn() {} } as never,
    );
    await provisioning.runProvisionJob(matchId);
    const bootJob = await prisma.job.findFirst({ where: { matchId, type: 'POLL_SERVER_BOOT' } });
    expect(bootJob).not.toBeNull();
    await provisioning.runBootPollJob(matchId, fakeDatHost.serverId, Date.now());

    expect(await requiredMatch(prisma, matchId)).toMatchObject({
      state: 'MATCH_LOADED',
      dathostServerId: fakeDatHost.serverId,
      dathostIp: '203.0.113.10',
      dathostPort: 27015,
    });
    expect(fakeDatHost.calls).toEqual(
      expect.arrayContaining(['create', 'duplicate', 'configure', 'start', 'console']),
    );
    expect(fakeDatHost.createRequests).toEqual([
      expect.objectContaining({ game: 'cs2', location: 'dallas', deletion_protection: false }),
    ]);
    expect(fakeDatHost.duplicateRequests).toEqual([
      {
        templateId: 'simulation-template',
        location: 'dallas',
        destinationServerId: fakeDatHost.serverId,
      },
    ]);
    expect(fakeDatHost.updateRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverId: fakeDatHost.serverId,
          fields: expect.objectContaining({
            'cs2_settings.slots': 11,
            'cs2_settings.enable_gotv': true,
            'cs2_settings.private_server': true,
            autostop: true,
            autostop_minutes: 15,
            deletion_protection: false,
            user_data: expect.stringMatching(/^tenman:/u),
          }),
        }),
      ]),
    );
    expect(fakeDatHost.consoleRequests).toEqual([
      expect.objectContaining({
        serverId: fakeDatHost.serverId,
        line: expect.stringContaining(
          `https://staging.invalid/internal/matches/${matchId}/matchzy-config`,
        ),
      }),
    ]);
    expect(await prisma.matchCredential.count({ where: { matchId } })).toBe(2);

    const events = new MatchZyEventService(
      prisma,
      { processDemoUploadEnded: async () => undefined } as never,
      60,
    );
    const matchzyMatchId = (await requiredMatch(prisma, matchId)).matchzyMatchId;
    await events.ingest(matchId, {
      event: 'series_start',
      matchid: matchzyMatchId,
      num_maps: 1,
      team1: { name: 'Team 1' },
      team2: { name: 'Team 2' },
    });
    await events.ingest(matchId, { event: 'going_live', matchid: matchzyMatchId, map_number: 0 });
    const seriesEnd = {
      event: 'series_end' as const,
      matchid: matchzyMatchId,
      team1_series_score: 13,
      team2_series_score: 8,
      winner: { team: 'team1' as const, side: 'ct' as const },
      time_until_restore: 0,
    };
    expect(await events.ingest(matchId, seriesEnd)).toBe('processed');
    expect(await events.ingest(matchId, seriesEnd)).toBe('duplicate');
    expect(await requiredMatch(prisma, matchId)).toMatchObject({
      state: 'FINISHED',
      cleanupStatus: 'PENDING',
      resultStatus: 'APPLIED',
    });
    expect(await prisma.matchRatingChange.count({ where: { matchId } })).toBe(10);

    const cleanupJob = await prisma.job.findUnique({
      where: { idempotencyKey: `cleanup:${matchId}` },
    });
    if (cleanupJob === null) throw new Error('Simulation cleanup job was not scheduled');
    const cleanupHandler = createJobHandlers({
      prisma,
      dathost: fakeDatHost as unknown as DatHostClient,
      discord: { guilds: { cache: new Map() } } as never,
      cipher: new CredentialCipher(randomBytes(32).toString('base64')),
      credentials: new MatchCredentialService(prisma),
      artifacts: { ensureArtifactsTerminal: async () => true } as never,
      publicBaseUrl: new URL('https://staging.invalid'),
      templateServerIds: new Set(['simulation-template']),
      componentSigningSecret: 'simulation-component-signing-secret',
      matchzyStaleAfterMs: 30_000,
      matchzyReconciliationIntervalMs: 30_000,
      logger: { info() {}, warn() {}, error() {} } as never,
    }).get('CLEANUP_MATCH');
    if (cleanupHandler === undefined)
      throw new Error('Simulation cleanup handler was not registered');
    await cleanupHandler({
      id: cleanupJob.id,
      type: cleanupJob.type,
      attempts: cleanupJob.attempts,
      payload: cleanupJob.payload,
      leaseToken: 'simulation-lease',
    });
    expect(await requiredMatch(prisma, matchId)).toMatchObject({
      cleanupStatus: 'COMPLETE',
      guildSlotActive: false,
    });
    expect(fakeDatHost.calls).toEqual(expect.arrayContaining(['stop', 'delete']));
    expect(await prisma.matchCredential.count({ where: { matchId, revokedAt: null } })).toBe(0);
    expect(await prisma.tenManQueue.findUnique({ where: { guildId } })).toMatchObject({
      status: 'OPEN',
    });
  }, 15_000);
});

async function requiredMatch(client: NonNullable<typeof prisma>, matchId: string) {
  const match = await client.match.findUnique({
    where: { id: matchId },
    include: { players: true },
  });
  if (match === null) throw new Error('Simulation match was not found');
  return match;
}

class SimulatedDatHost {
  public readonly serverId = 'simulated-dathost-server';
  public readonly calls: string[] = [];
  public readonly createRequests: Array<Readonly<Record<string, string | number | boolean>>> = [];
  public readonly duplicateRequests: Array<{
    templateId: string;
    location: string;
    destinationServerId: string | undefined;
  }> = [];
  public readonly updateRequests: Array<{
    serverId: string;
    fields: Readonly<Record<string, string | number | boolean>>;
  }> = [];
  public readonly consoleRequests: Array<{ serverId: string; line: string }> = [];
  private userData: string | undefined;

  public async createProvisionalServer(
    fields: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatHostServer> {
    this.calls.push('create');
    this.createRequests.push(fields);
    return this.server(false);
  }
  public async duplicateServer(
    templateId: string,
    location: string,
    destinationServerId?: string,
  ): Promise<DatHostServer> {
    this.calls.push('duplicate');
    this.duplicateRequests.push({ templateId, location, destinationServerId });
    return this.server(false);
  }
  public async listServers(): Promise<DatHostServer[]> {
    return [this.server(false)];
  }
  public async updateServer(
    serverId: string,
    fields: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatHostServer> {
    this.calls.push('configure');
    this.updateRequests.push({ serverId, fields });
    const userData = fields.user_data;
    if (typeof userData === 'string') this.userData = userData;
    return this.server(false);
  }
  public async startServer(): Promise<void> {
    this.calls.push('start');
  }
  public async getServer(): Promise<DatHostServer> {
    return this.server(false);
  }
  public async sendConsole(serverId: string, line: string): Promise<void> {
    this.calls.push('console');
    this.consoleRequests.push({ serverId, line });
  }
  public async stopServer(): Promise<void> {
    this.calls.push('stop');
  }
  public async deleteServer(): Promise<void> {
    this.calls.push('delete');
  }

  private server(booting: boolean): DatHostServer {
    return {
      id: this.serverId,
      name: '10man simulation',
      user_data: this.userData,
      created_at: 0,
      booting,
      ip: '203.0.113.10',
      ports: { game: 27015 },
    };
  }
}
