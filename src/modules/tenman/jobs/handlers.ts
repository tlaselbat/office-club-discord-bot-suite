import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostClient } from '../integrations/dathost/client.js';
import { ProvisioningOrchestrator } from '../orchestrator/provisioning.js';
import { CleanupOrchestrator } from '../orchestrator/cleanup.js';
import { PrismaProvisioningRepository } from '../database/provisioning-repository.js';
import { PrismaCleanupRepository } from '../database/cleanup-repository.js';
import { DiscordVoiceAdapter } from '../services/discord-voice.js';
import { PanelService } from '../services/panel-service.js';
import { OrphanScanner } from '../services/orphan-scanner.js';
import { MatchZyReconciliationService } from '../services/matchzy-reconciliation-service.js';
import type { CredentialCipher } from '../services/credential-cipher.js';
import type { MatchCredentialService } from '../services/match-credential-service.js';
import { ProvisioningService } from '../services/provisioning-service.js';
import type { JobHandler, LeasedJob } from '../../../jobs/worker.js';

export interface WorkerDependencies {
  prisma: PrismaClient;
  dathost: DatHostClient;
  discord: Client;
  cipher: CredentialCipher;
  credentials: MatchCredentialService;
  publicBaseUrl: URL;
  templateServerIds: ReadonlySet<string>;
  componentSigningSecret: string;
  matchzyStaleAfterMs: number;
  matchzyReconciliationIntervalMs: number;
  logger: Logger;
}

export function createJobHandlers(dependencies: WorkerDependencies): Map<string, JobHandler> {
  const provisioningOrchestrator = new ProvisioningOrchestrator(
    new PrismaProvisioningRepository(dependencies.prisma),
    dependencies.dathost,
    dependencies.templateServerIds,
  );

  const provisioning = new ProvisioningService(
    dependencies.prisma,
    provisioningOrchestrator,
    dependencies.dathost,
    dependencies.credentials,
    dependencies.cipher,
    dependencies.publicBaseUrl,
    dependencies.logger,
  );

  const voice = new DiscordVoiceAdapter(dependencies.prisma, dependencies.discord);

  const cleanup = new CleanupOrchestrator(
    new PrismaCleanupRepository(dependencies.prisma),
    dependencies.dathost,
    voice,
    dependencies.templateServerIds,
  );

  const panel = new PanelService(
    dependencies.prisma,
    dependencies.discord,
    dependencies.componentSigningSecret,
  );

  const orphanScanner = new OrphanScanner(
    dependencies.prisma,
    dependencies.dathost,
    dependencies.templateServerIds,
  );

  const matchzyReconciliation = new MatchZyReconciliationService(
    dependencies.prisma,
    dependencies.dathost,
    dependencies.matchzyStaleAfterMs,
    dependencies.logger,
  );

  const provisionHandler: JobHandler = (job: LeasedJob) => {
    const payload = job.payload as { matchId: string };
    return provisioning.runProvisionJob(payload.matchId);
  };
  provisionHandler.onPermanentFailure = (job, error) =>
    failProvisioning(dependencies.prisma, (job.payload as { matchId: string }).matchId, error);

  const bootHandler: JobHandler = (job: LeasedJob) => {
    const payload = job.payload as { matchId: string; serverId: string; startedAt: number };
    return provisioning.runBootPollJob(payload.matchId, payload.serverId, payload.startedAt);
  };
  bootHandler.onPermanentFailure = (job, error) =>
    failProvisioning(dependencies.prisma, (job.payload as { matchId: string }).matchId, error);

  return new Map<string, JobHandler>([
    ['PROVISION_SERVER', provisionHandler],
    ['POLL_SERVER_BOOT', bootHandler],
    [
      'CLEANUP_MATCH',
      (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        return cleanupJob(dependencies.prisma, cleanup, matchId);
      },
    ],
    [
      'VOICE_RECONCILE',
      (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        return voice.reconcileMatchVoice(matchId);
      },
    ],
    [
      'PANEL_REFRESH',
      (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        return panel.refresh(matchId);
      },
    ],
    [
      'ORPHAN_SCAN',
      async () => {
        await orphanScanner.scan();
        return { rescheduleAt: new Date(Date.now() + 60 * 60 * 1000) };
      },
    ],
    [
      'MATCHZY_RECONCILE',
      async () => {
        await matchzyReconciliation.runPeriodicReconciliation();
        return {
          rescheduleAt: new Date(Date.now() + dependencies.matchzyReconciliationIntervalMs),
        };
      },
    ],
  ]);
}

async function failProvisioning(
  prisma: PrismaClient,
  matchId: string,
  error: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const match = await transaction.match.findUnique({ where: { id: matchId } });
    if (match === null || ['FINISHED', 'CANCELED', 'FAILED'].includes(match.state)) return;
    const attempt = await transaction.provisioningAttempt.findFirst({
      where: { matchId },
      select: { id: true },
    });
    const requiresCleanup = match.dathostServerId !== null || attempt !== null;
    await transaction.match.update({
      where: { id: matchId },
      data: {
        state: 'FAILED',
        cleanupStatus: requiresCleanup ? 'PENDING' : 'NOT_REQUIRED',
        guildSlotActive: requiresCleanup,
        failureReason: error.slice(0, 1000),
        finishedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await transaction.matchStateTransition.create({
      data: {
        matchId,
        fromState: match.state,
        toState: 'FAILED',
        source: 'WORKER_FAILURE',
        reason: error.slice(0, 1000),
      },
    });
    if (requiresCleanup) {
      await transaction.job.upsert({
        where: { idempotencyKey: `cleanup:${matchId}` },
        update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
        create: {
          matchId,
          type: 'CLEANUP_MATCH',
          idempotencyKey: `cleanup:${matchId}`,
          payload: { matchId },
        },
      });
    }
    await transaction.job.upsert({
      where: { idempotencyKey: `panel:${matchId}:failure` },
      update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
      create: {
        matchId,
        type: 'PANEL_REFRESH',
        idempotencyKey: `panel:${matchId}:failure`,
        payload: { matchId },
      },
    });
  });
}

async function cleanupJob(
  prisma: PrismaClient,
  cleanup: CleanupOrchestrator,
  matchId: string,
): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { dathostServerId: true, cleanupStatus: true },
  });
  if (match === null) return;
  await cleanup.cleanup({
    matchId,
    serverId: match.dathostServerId,
    ownedServerId: match.dathostServerId,
    cleanupStatus: match.cleanupStatus as 'PENDING' | 'RUNNING' | 'RETRY' | 'FAILED',
  });
}
