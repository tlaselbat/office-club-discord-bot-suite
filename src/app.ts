import type { Client } from 'discord.js';
import type { FastifyInstance } from 'fastify';
import { createDiscordClient } from './bot/client.js';
import type { Environment } from './config/environment.js';
import { createPrismaClient } from './database/prisma.js';
import { PrismaJobStore } from './database/job-store.js';
import { PrismaSteamLinkRepository } from './modules/tenman/database/steam-link-repository.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { createHttpServer } from './http/server.js';
import type { Logger } from 'pino';
import { MatchService } from './modules/tenman/services/match-service.js';
import { SteamLinkService } from './modules/tenman/services/steam-link-service.js';
import { MatchCredentialService } from './modules/tenman/services/match-credential-service.js';
import { MatchZyEventService } from './modules/tenman/services/matchzy-event-service.js';
import { StartupRecovery } from './modules/tenman/services/startup-recovery.js';
import { MatchControlService } from './modules/tenman/services/match-control-service.js';
import { CredentialCipher } from './modules/tenman/services/credential-cipher.js';
import { DiagnosticsService } from './modules/tenman/services/diagnostics-service.js';
import { GuildResourceService } from './modules/tenman/services/guild-resource-service.js';
import { GuildSettingsService } from './modules/tenman/services/guild-settings-service.js';
import { WebSessionService } from './services/web-session-service.js';
import { DatHostClient } from './modules/tenman/integrations/dathost/client.js';
import { WorkerRunner } from './jobs/runner.js';
import { ModuleRegistry } from './core/modules/registry.js';
import { createTenManModule } from './modules/tenman/module.js';
import { createRewardsModule } from './modules/rewards/module.js';

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
  const steamLinkService = new SteamLinkService(
    new PrismaSteamLinkRepository(prisma),
    new URL(environment.PUBLIC_BASE_URL),
  );
  const matchService = new MatchService(prisma);
  const credentialService = new MatchCredentialService(prisma);
  const matchzyEventService = new MatchZyEventService(prisma);
  const cipher = new CredentialCipher(environment.CREDENTIAL_ENCRYPTION_KEY);
  const dathost = new DatHostClient({
    email: environment.DATHOST_EMAIL,
    password: environment.DATHOST_PASSWORD,
  });
  const matchControlService = new MatchControlService(prisma, dathost, logger);
  const discord = createDiscordClient({
    token: environment.DISCORD_TOKEN,
    clientId: environment.DISCORD_CLIENT_ID,
    prisma,
    matchService,
    steamLinkService,
    matchControlService,
    dathost,
    cipher,
    componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
    logger,
  });
  const guildSettingsService = new GuildSettingsService(prisma, discord);
  const guildResourceService = new GuildResourceService(prisma, discord, logger);
  const diagnosticsService = new DiagnosticsService(prisma, discord, dathost);
  const http = await createHttpServer({
    logger,
    readiness: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    steam: { steamLinkService, publicBaseUrl: new URL(environment.PUBLIC_BASE_URL) },
    matchzy: { prisma, credentials: credentialService, events: matchzyEventService },
    admin: {
      prisma,
      discord,
      settings: guildSettingsService,
      resources: guildResourceService,
      diagnostics: diagnosticsService,
      sessions: new WebSessionService(prisma),
      publicBaseUrl: new URL(environment.PUBLIC_BASE_URL),
      clientId: environment.DISCORD_CLIENT_ID,
      clientSecret: environment.DISCORD_CLIENT_SECRET,
      ownerIds: environment.PANEL_OWNER_DISCORD_USER_IDS,
      sessionSecret: environment.PANEL_SESSION_SECRET,
    },
  });
  const modules = new ModuleRegistry([
    createTenManModule({
      prisma,
      dathost,
      discord,
      cipher,
      credentials: credentialService,
      publicBaseUrl: new URL(environment.PUBLIC_BASE_URL),
      templateServerIds: new Set([environment.DATHOST_TEMPLATE_SERVER_ID]),
      componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
      matchzyStaleAfterMs: environment.MATCHZY_STALE_AFTER_MS,
      matchzyReconciliationIntervalMs: environment.MATCHZY_RECONCILIATION_INTERVAL_MS,
      logger,
    }),
    createRewardsModule({
      prisma,
      discord,
      logger,
      componentSigningSecret: environment.MATCH_TOKEN_SIGNING_SECRET,
    }),
  ]);
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
  return {
    prisma,
    http,
    discord,
    worker,
    async start() {
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
    },
    async stop() {
      await worker.stop();
      await modules.stop();
      await discord.destroy();
      await http.close();
      await prisma.$disconnect();
    },
  };
}
