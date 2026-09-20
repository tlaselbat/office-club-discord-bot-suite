import type { PrismaClient } from '../../../generated/prisma/client.js';

const PROVISIONING_STATES = ['SERVER_PROVISIONING'] as const;
const BOOT_STATES = ['SERVER_BOOTING', 'SERVER_READY'] as const;
const ACTIVE_MATCH_STATES = ['MATCH_LOADED', 'WARMUP', 'LIVE', 'PAUSED'] as const;
const CLEANUP_STATUSES = ['PENDING', 'RUNNING', 'RETRY', 'FAILED'] as const;

export class StartupRecovery {
  public constructor(private readonly prisma: PrismaClient) {}

  public async run(): Promise<void> {
    const matches = await this.prisma.match.findMany({
      where: { guildSlotActive: true },
      select: {
        id: true,
        state: true,
        cleanupStatus: true,
        dathostServerId: true,
        phaseDeadlineAt: true,
        version: true,
      },
    });

    for (const match of matches) {
      await this.recoverMatch(match);
    }

    const queues = await this.prisma.tenManQueue.findMany({
      where: { guild: { enabled: true } },
      select: { guildId: true },
    });
    for (const queue of queues) {
      await this.enqueue(
        'QUEUE_PANEL_REFRESH',
        { guildId: queue.guildId },
        `queue-panel:${queue.guildId}`,
      );
    }

    await this.enqueue('ORPHAN_SCAN', {}, 'orphan-scan', new Date(Date.now() + 5 * 60 * 1000));
    await this.enqueue(
      'MATCHZY_RECONCILE',
      {},
      'matchzy-reconcile',
      new Date(Date.now() + 30 * 1000),
    );
  }

  private async recoverMatch(match: {
    id: string;
    state: string;
    cleanupStatus: string;
    dathostServerId: string | null;
    phaseDeadlineAt: Date | null;
    version: number;
  }): Promise<void> {
    const { id: matchId, state, cleanupStatus, dathostServerId: serverId } = match;
    if (!['FINISHED', 'CANCELED', 'FAILED'].includes(state) && cleanupStatus === 'NOT_REQUIRED') {
      await this.enqueue('MATCH_RESOURCE_RECONCILE', { matchId }, `match-resources:${matchId}`);
      if (
        ['READY_CHECK', 'TEAM_SELECTION', 'MAP_VETO'].includes(state) &&
        match.phaseDeadlineAt !== null
      ) {
        await this.enqueue(
          'MATCH_PHASE_TIMEOUT',
          {
            matchId,
            expectedState: state,
            expectedVersion: match.version,
            deadline: match.phaseDeadlineAt.toISOString(),
          },
          `phase-timeout:${matchId}:${state}:${String(match.version)}`,
          match.phaseDeadlineAt,
        );
      }
    }
    if (PROVISIONING_STATES.includes(state as (typeof PROVISIONING_STATES)[number])) {
      await this.enqueue('PROVISION_SERVER', { matchId }, `provision:${matchId}`);
      return;
    }

    if (BOOT_STATES.includes(state as (typeof BOOT_STATES)[number]) && serverId !== null) {
      await this.enqueue(
        'POLL_SERVER_BOOT',
        { matchId, serverId, startedAt: Date.now() },
        `poll-boot:${matchId}:${serverId}`,
      );
      return;
    }

    if (ACTIVE_MATCH_STATES.includes(state as (typeof ACTIVE_MATCH_STATES)[number])) {
      await this.enqueue(
        'MATCH_DASHBOARD_REFRESH',
        { matchId },
        `match-dashboard:${matchId}:recovery`,
      );
      await this.enqueue('VOICE_RECONCILE', { matchId }, `voice:${matchId}:recovery`);
    }

    if (CLEANUP_STATUSES.includes(cleanupStatus as (typeof CLEANUP_STATUSES)[number])) {
      await this.enqueue('CLEANUP_MATCH', { matchId }, `cleanup:${matchId}`);
    }
  }

  private async enqueue(
    type: string,
    payload: object,
    idempotencyKey: string,
    runAt?: Date,
  ): Promise<void> {
    const scheduledAt = runAt ?? new Date();
    await this.prisma.job.upsert({
      where: { idempotencyKey },
      update: {
        status: 'PENDING',
        attempts: 0,
        runAt: scheduledAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
      create: { type, payload, idempotencyKey, runAt: scheduledAt },
    });
  }
}
