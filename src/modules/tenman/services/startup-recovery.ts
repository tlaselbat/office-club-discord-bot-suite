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
      },
    });

    for (const match of matches) {
      await this.recoverMatch(match.id, match.state, match.cleanupStatus, match.dathostServerId);
    }

    await this.enqueue('ORPHAN_SCAN', {}, 'orphan-scan', new Date(Date.now() + 5 * 60 * 1000));
    await this.enqueue(
      'MATCHZY_RECONCILE',
      {},
      'matchzy-reconcile',
      new Date(Date.now() + 30 * 1000),
    );
  }

  private async recoverMatch(
    matchId: string,
    state: string,
    cleanupStatus: string,
    serverId: string | null,
  ): Promise<void> {
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
      await this.enqueue('PANEL_REFRESH', { matchId }, `panel:${matchId}:recovery`);
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
