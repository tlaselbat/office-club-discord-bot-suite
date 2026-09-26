import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostClient } from '../integrations/dathost/client.js';
import { ProvisioningOrchestrator } from '../orchestrator/provisioning.js';
import { CleanupOrchestrator } from '../orchestrator/cleanup.js';
import { PrismaProvisioningRepository } from '../database/provisioning-repository.js';
import { PrismaCleanupRepository } from '../database/cleanup-repository.js';
import { DiscordVoiceAdapter } from '../services/discord-voice.js';
import { OrphanScanner } from '../services/orphan-scanner.js';
import { MatchZyReconciliationService } from '../services/matchzy-reconciliation-service.js';
import type { CredentialCipher } from '../services/credential-cipher.js';
import type { MatchCredentialService } from '../services/match-credential-service.js';
import { ProvisioningService } from '../services/provisioning-service.js';
import { ReadyCheckService } from '../services/ready-check-service.js';
import { PhaseTimeoutService } from '../services/phase-timeout-service.js';
import { MatchResourceService } from '../services/match-resource-service.js';
import { QueuePanelService } from '../services/queue-panel-service.js';
import { AdminPanelService } from '../services/admin-panel-service.js';
import { MatchDashboardService } from '../services/match-dashboard-service.js';
import { MatchResultReceiptService } from '../services/match-result-receipt-service.js';
import type { MatchArtifactService } from '../services/match-artifact-service.js';
import type { JobHandler, LeasedJob } from '../../../jobs/worker.js';
import { scheduleJob } from '../../../database/schedule-job.js';

export interface WorkerDependencies {
  prisma: PrismaClient;
  dathost: DatHostClient;
  discord: Client;
  cipher: CredentialCipher;
  credentials: MatchCredentialService;
  artifacts: MatchArtifactService;
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
  const readyCheck = new ReadyCheckService(dependencies.prisma);
  const phaseTimeout = new PhaseTimeoutService(dependencies.prisma);
  const matchResources = new MatchResourceService(dependencies.prisma, dependencies.discord);
  const queuePanel = new QueuePanelService(
    dependencies.prisma,
    dependencies.discord,
    dependencies.componentSigningSecret,
  );
  const adminPanel = new AdminPanelService(
    dependencies.prisma,
    dependencies.discord,
    dependencies.componentSigningSecret,
  );
  const dashboard = new MatchDashboardService(
    dependencies.prisma,
    dependencies.discord,
    dependencies.componentSigningSecret,
  );
  const resultReceipt = new MatchResultReceiptService(dependencies.prisma, dependencies.discord);

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
      'MATCH_DASHBOARD_REFRESH',
      async (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        await dashboard.refresh(matchId);
      },
    ],
    [
      'MATCH_RESULT_RECEIPT',
      async (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        await resultReceipt.postReceipt(matchId);
      },
    ],
    [
      'COLLECT_MATCH_ARTIFACTS',
      async (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        const rescheduleAt = await dependencies.artifacts.collectArtifacts(
          matchId,
          `job:${job.id}`,
        );
        return rescheduleAt === undefined ? undefined : { rescheduleAt };
      },
    ],
    [
      'QUEUE_PANEL_REFRESH',
      async (job: LeasedJob) => {
        const { guildId } = job.payload as { guildId: string };
        await queuePanel.reconcile(guildId);
        await adminPanel.reconcile(guildId);
      },
    ],
    [
      'MATCH_RESOURCE_RECONCILE',
      async (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        await matchResources.ensureMatchTextChannel(matchId);
        await dashboard.refresh(matchId);
      },
    ],
    [
      'MATCH_PHASE_TIMEOUT',
      (job: LeasedJob) => {
        const payload = job.payload as {
          matchId: string;
          expectedState: string;
          expectedVersion: number;
          correlationId?: string;
        };
        const correlationId = payload.correlationId ?? `job:${job.id}`;
        if (payload.expectedState === 'READY_CHECK')
          return readyCheck.expire(payload.matchId, payload.expectedVersion, correlationId);
        return phaseTimeout.expire(
          payload.matchId,
          payload.expectedState,
          payload.expectedVersion,
          correlationId,
        );
      },
    ],
    [
      'CLEANUP_MATCH',
      (job: LeasedJob) => {
        const { matchId } = job.payload as { matchId: string };
        return cleanupJob(
          dependencies.prisma,
          cleanup,
          matchResources,
          dependencies.artifacts,
          matchId,
        );
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

export async function failProvisioning(
  prisma: PrismaClient,
  matchId: string,
  error: string,
): Promise<void> {
  const requiresCleanup = await prisma.$transaction(async (transaction) => {
    const match = await transaction.match.findUnique({ where: { id: matchId } });
    if (match === null || ['FINISHED', 'CANCELED', 'FAILED'].includes(match.state)) return null;
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
      await scheduleJob(transaction, {
        type: 'CLEANUP_MATCH',
        idempotencyKey: `cleanup:${matchId}`,
        matchId,
        payload: { matchId },
      });
    }
    await scheduleJob(transaction, {
      type: 'MATCH_DASHBOARD_REFRESH',
      idempotencyKey: `panel:${matchId}:failure`,
      matchId,
      payload: { matchId },
    });
    return requiresCleanup;
  });
  // No external resource exists to clean up, so this terminal failure must not
  // leave the guild's durable queue locked behind a cleanup job that will never run.
  if (requiresCleanup === false) await reopenQueueAfterCleanup(prisma, matchId);
}

async function cleanupJob(
  prisma: PrismaClient,
  cleanup: CleanupOrchestrator,
  matchResources: MatchResourceService,
  artifacts: MatchArtifactService,
  matchId: string,
): Promise<{ rescheduleAt: Date } | undefined> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { dathostServerId: true, cleanupStatus: true },
  });
  if (match === null) return;
  const artifactsReady = await artifacts.ensureArtifactsTerminal(matchId);
  if (!artifactsReady) {
    return { rescheduleAt: new Date(Date.now() + 60_000) };
  }
  await cleanup.cleanup({
    matchId,
    serverId: match.dathostServerId,
    ownedServerId: match.dathostServerId,
    cleanupStatus: match.cleanupStatus as 'PENDING' | 'RUNNING' | 'RETRY' | 'FAILED',
  });
  const resources = await prisma.matchDiscordResource.findMany({
    where: {
      matchId,
      createdByBot: true,
      resourceType: 'MATCH_TEXT_CHANNEL',
      state: { notIn: ['DELETED', 'ARCHIVED'] },
    },
    select: { id: true },
  });
  for (const resource of resources) await matchResources.archiveOwnedChannel(resource.id);
  await reopenQueueAfterCleanup(prisma, matchId);
  return undefined;
}

/** Reopens the persistent queue after cleanup, or immediately when cleanup was never required. */
async function reopenQueueAfterCleanup(prisma: PrismaClient, matchId: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const match = await transaction.match.findUnique({ where: { id: matchId } });
    if (
      match === null ||
      !['COMPLETE', 'NOT_REQUIRED'].includes(match.cleanupStatus) ||
      !['FINISHED', 'CANCELED', 'FAILED'].includes(match.state)
    )
      return;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${match.guildId}, 0))`;
    const reopened = await transaction.tenManQueue.updateMany({
      where: { guildId: match.guildId, status: 'LOCKED' },
      data: { status: 'OPEN', version: { increment: 1 }, lastQueueAlertCount: 0 },
    });
    if (reopened.count !== 1) return;
    await scheduleJob(transaction, {
      type: 'QUEUE_PANEL_REFRESH',
      idempotencyKey: `queue-panel:${match.guildId}`,
      payload: { guildId: match.guildId },
    });
    await transaction.auditEvent.create({
      data: {
        matchId,
        guildId: match.guildId,
        eventType: 'queue_reopened_after_cleanup',
        result: 'success',
        correlationId: `cleanup:${matchId}`,
        metadata: {},
      },
    });
  });
}
