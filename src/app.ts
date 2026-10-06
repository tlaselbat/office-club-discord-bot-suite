import type { Client } from 'discord.js';
import type { FastifyInstance } from 'fastify';
import { createDiscordClient } from './bot/client.js';
import type { Environment } from './config/environment.js';
import { createPrismaClient } from './database/prisma.js';
import { PrismaJobStore } from './database/job-store.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { createHttpServer } from './http/server.js';
import type { Logger } from 'pino';
import { MatchService } from './modules/tenman/services/match-service.js';
import { createSteamProfileService } from './modules/tenman/services/steam-profile-service.js';
import { SteamAccountService } from './modules/tenman/services/steam-account-service.js';
import { MatchCredentialService } from './modules/tenman/services/match-credential-service.js';
import { MatchZyEventService } from './modules/tenman/services/matchzy-event-service.js';
import { StartupRecovery } from './modules/tenman/services/startup-recovery.js';
import { CredentialCipher } from './modules/tenman/services/credential-cipher.js';
import { DiagnosticsService } from './modules/tenman/services/diagnostics-service.js';
import { GuildResourceService } from './modules/tenman/services/guild-resource-service.js';
import { GuildSettingsService } from './modules/tenman/services/guild-settings-service.js';
import { WebSessionService } from './services/web-session-service.js';
import { DatHostClient } from './integrations/dathost/client.js';
import { GameServerAdminService } from './modules/game-servers/services/game-server-admin-service.js';
import { GameServerCardService } from './modules/game-servers/card-service.js';
import { GameServerDiagnosticsService } from './modules/game-servers/services/game-server-diagnostics-service.js';
import { GameServerPanelService } from './modules/game-servers/panel-service.js';
import { createArtifactStorage } from './modules/tenman/services/artifact-storage.js';
import { MatchArtifactService } from './modules/tenman/services/match-artifact-service.js';
import { WorkerRunner } from './jobs/runner.js';
import { ModuleRegistry } from './core/modules/registry.js';
import { createSuiteModules } from './core/modules/composition.js';

export interface Application {
  prisma: PrismaClient;
  http: FastifyInstance;
  discord: Client;
  worker: WorkerRunner;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createApplication(
  environment: Environment,
  logger: Logger,
): Promise<Application> {
  const prisma = createPrismaClient(environment.DATABASE_URL);
  const steamProfileService = createSteamProfileService(environment.STEAM_API_KEY);
  const steamAccountService = new SteamAccountService(prisma, steamProfileService);
  const matchService = new MatchService(prisma);
  const credentialService = new MatchCredentialService(prisma);
  const cipher = new CredentialCipher(environment.CREDENTIAL_ENCRYPTION_KEY);
  const dathost = new DatHostClient({
    email: environment.DATHOST_EMAIL,
    password: environment.DATHOST_PASSWORD,
  });
  const artifactStorage = createArtifactStorage(environment);
  const matchArtifactService = new MatchArtifactService(prisma, dathost, artifactStorage);
  const matchzyEventService = new MatchZyEventService(
    prisma,
    matchArtifactService,
    environment.DEMO_COLLECTION_DEADLINE_SECONDS,
  );
  const discord = createDiscordClient({
    token: environment.DISCORD_TOKEN,
    clientId: environment.DISCORD_CLIENT_ID,
    prisma,
    matchService,
    steamAccountService,
    steamProfileService,
    dathost,
    componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
    credentialCipher: cipher,
    logger,
  });
  const guildSettingsService = new GuildSettingsService(prisma, discord);
  const guildResourceService = new GuildResourceService(prisma, discord, logger);
  const diagnosticsService = new DiagnosticsService(prisma, discord, dathost);
  const gameServerPanelService = new GameServerPanelService(
    prisma,
    discord,
    environment.MATCH_TOKEN_SIGNING_SECRET,
  );
  const gameServerCardService = new GameServerCardService(
    prisma,
    discord,
    environment.MATCH_TOKEN_SIGNING_SECRET,
  );
  const gameServerAdmin = new GameServerAdminService({
    prisma,
    discord,
    dathost,
    panelService: gameServerPanelService,
    cardService: gameServerCardService,
  });
  const gameServerDiagnostics = new GameServerDiagnosticsService(prisma, dathost);
  let startupComplete = false;
  const http = await createHttpServer({
    logger,
    readiness: async () => {
      if (!startupComplete || !discord.isReady()) return false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    matchzy: { prisma, credentials: credentialService, events: matchzyEventService },
    admin: {
      prisma,
      discord,
      settings: guildSettingsService,
      resources: guildResourceService,
      diagnostics: diagnosticsService,
      gameServerAdmin,
      gameServerDiagnostics,
      sessions: new WebSessionService(prisma),
      publicBaseUrl: new URL(environment.PUBLIC_BASE_URL),
      clientId: environment.DISCORD_CLIENT_ID,
      clientSecret: environment.DISCORD_CLIENT_SECRET,
      ownerIds: environment.PANEL_OWNER_DISCORD_USER_IDS,
      sessionSecret: environment.PANEL_SESSION_SECRET,
    },
  });
  const modules = new ModuleRegistry(
    createSuiteModules({
      competitive: {
        dependencies: {
          prisma,
          dathost,
          discord,
          cipher,
          credentials: credentialService,
          artifacts: matchArtifactService,
          publicBaseUrl: new URL(environment.PUBLIC_BASE_URL),
          templateServerIds: new Set([environment.DATHOST_TEMPLATE_SERVER_ID]),
          componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
          matchzyStaleAfterMs: environment.MATCHZY_STALE_AFTER_MS,
          matchzyReconciliationIntervalMs: environment.MATCHZY_RECONCILIATION_INTERVAL_MS,
          logger,
        },
      },
      rewards: {
        prisma,
        discord,
        logger,
        componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
      },
      gameServers: {
        prisma,
        discord,
        dathost,
        componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
        logger,
      },
    }),
  );
  const worker = new WorkerRunner(
    new PrismaJobStore(prisma),
    modules.jobHandlers(),
    {
      workerId: 'primary',
      pollIntervalMs: environment.WORKER_POLL_INTERVAL_MS,
      leaseMs: 30_000,
      maxAttempts: 100,
      baseRetryMs: 5_000,
      maxRetryMs: 60_000,
    },
    logger,
  );
  const stop = async (): Promise<void> => {
    startupComplete = false;
    const failures: unknown[] = [];
    for (const cleanup of [
      () => worker.stop(),
      () => modules.stop(),
      () => discord.destroy(),
      () => http.close(),
      () => prisma.$disconnect(),
    ]) {
      try {
        await cleanup();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Application shutdown failed');
    }
  };
  return {
    prisma,
    http,
    discord,
    worker,
    async start() {
      startupComplete = false;
      try {
        await prisma.$connect();
        await http.listen({ host: environment.HOST, port: environment.PORT });
        await discord.login(environment.DISCORD_TOKEN);
        await prisma.guildSettings.createMany({
          data: [...discord.guilds.cache.keys()].map((guildId) => ({ guildId })),
          skipDuplicates: true,
        });
        await new StartupRecovery(prisma).run();
        await modules.start();
        worker.start();
        startupComplete = true;
      } catch (error: unknown) {
        await stop().catch(() => undefined);
        throw error;
      }
    },
    stop,
  };
}
