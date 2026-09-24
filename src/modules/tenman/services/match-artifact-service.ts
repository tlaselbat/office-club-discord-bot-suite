import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import type { DemoReference, PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostClient } from '../integrations/dathost/client.js';
import type { MatchZyEvent } from '../integrations/matchzy/schemas.js';
import type { ArtifactStorage } from './artifact-storage.js';
import { scheduleJob } from '../../../database/schedule-job.js';

const TERMINAL_STATUSES = new Set(['STORED', 'UNAVAILABLE', 'FAILED', 'EXPIRED']);
const MAX_RETRIES = 5;
const COLLECTION_RETRY_DELAY_MS = 60_000;

export class MatchArtifactService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly dathost: DatHostClient,
    private readonly storage: ArtifactStorage,
  ) {}

  public async recordExpected(
    matchId: string,
    mapNumber: number,
    mapName: string,
    deadlineSeconds: number,
    correlationId: string,
  ): Promise<void> {
    const deadline = new Date(Date.now() + deadlineSeconds * 1000);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        select: { guildId: true },
      });
      if (match === null) throw new Error('Match not found');
      const existing = await transaction.demoReference.findUnique({
        where: { matchId_mapNumber: { matchId, mapNumber } },
      });
      if (existing !== null) return;
      await transaction.demoReference.create({
        data: {
          matchId,
          mapNumber,
          mapName,
          status: 'EXPECTED',
          collectionDeadlineAt: deadline,
        },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          eventType: 'artifact_expected',
          result: 'success',
          correlationId,
          metadata: { mapNumber, deadlineSeconds },
        },
      });
    });
  }

  public async processDemoUploadEnded(
    matchId: string,
    event: Extract<MatchZyEvent, { event: 'demo_upload_ended' }>,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        select: { guildId: true },
      });
      if (match === null) throw new Error('Match not found');
      const ref = await transaction.demoReference.findUnique({
        where: { matchId_mapNumber: { matchId, mapNumber: event.map_number } },
      });
      if (ref === null) {
        await transaction.demoReference.create({
          data: {
            matchId,
            mapNumber: event.map_number,
            mapName: 'unknown',
            status: event.success ? 'SOURCE_READY' : 'UNAVAILABLE',
            sourceFilename: event.success ? event.filename : null,
            observedAt: event.success ? new Date() : null,
            failureReason: event.success ? null : 'MatchZy reported demo upload failure',
            collectionDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      } else {
        await transaction.demoReference.update({
          where: { id: ref.id },
          data: {
            status: event.success ? 'SOURCE_READY' : 'UNAVAILABLE',
            sourceFilename: event.success ? event.filename : null,
            observedAt: event.success ? new Date() : null,
            failureReason: event.success ? null : 'MatchZy reported demo upload failure',
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          eventType: 'demo_upload_event_recorded',
          result: event.success ? 'success' : 'failure',
          correlationId,
          metadata: { mapNumber: event.map_number, filename: event.filename },
        },
      });
    });
  }

  public async ensureArtifactsTerminal(matchId: string, now = new Date()): Promise<boolean> {
    const terminalNow = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const refs = await transaction.demoReference.findMany({ where: { matchId } });
      let allTerminal = true;
      let changed = false;
      for (const ref of refs) {
        if (TERMINAL_STATUSES.has(ref.status)) continue;
        allTerminal = false;
        if (ref.collectionDeadlineAt <= now) {
          await transaction.demoReference.update({
            where: { id: ref.id },
            data: {
              status: 'EXPIRED',
              expiredAt: now,
              failureReason: 'Collection deadline expired before cleanup',
            },
          });
          changed = true;
        }
      }
      const becameTerminal = allTerminal || refs.every((ref) => TERMINAL_STATUSES.has(ref.status));
      return { becameTerminal, changed };
    });
    if (terminalNow.changed) {
      await this.scheduleReceiptRefresh(matchId);
    }
    return terminalNow.becameTerminal;
  }

  private async scheduleReceiptRefresh(matchId: string): Promise<void> {
    await scheduleJob(this.prisma, {
      type: 'MATCH_RESULT_RECEIPT',
      idempotencyKey: `receipt:${matchId}`,
      matchId,
      payload: { matchId },
    });
  }

  public async collectArtifacts(matchId: string, correlationId: string): Promise<Date | undefined> {
    let guildId = '';
    let terminalReached = false;
    const refs = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { demoReferences: true },
      });
      if (match === null) throw new Error('Match not found');
      guildId = match.guildId;
      const pending = match.demoReferences.filter((ref) => !TERMINAL_STATUSES.has(ref.status));
      if (pending.length === 0) return [];
      if (!this.storage.available) {
        for (const ref of pending) {
          await transaction.demoReference.update({
            where: { id: ref.id },
            data: { status: 'UNAVAILABLE', failureReason: 'Artifact storage not configured' },
          });
          await transaction.auditEvent.create({
            data: {
              matchId,
              guildId: match.guildId,
              eventType: 'artifact_collection_failed',
              result: 'failure',
              correlationId,
              metadata: { mapNumber: ref.mapNumber, reason: 'storage_unavailable' },
            },
          });
        }
        terminalReached = true;
        return [];
      }
      const now = new Date();
      const readyRefs = pending.filter(
        (ref) => ref.status === 'SOURCE_READY' && ref.sourceFilename !== null,
      );
      for (const ref of pending) {
        if (ref.collectionDeadlineAt <= now) {
          await transaction.demoReference.update({
            where: { id: ref.id },
            data: {
              status: 'EXPIRED',
              expiredAt: now,
              failureReason: 'Collection deadline expired',
            },
          });
          terminalReached = true;
        }
      }
      for (const ref of readyRefs) {
        await transaction.demoReference.update({
          where: { id: ref.id },
          data: { status: 'TRANSFERRING' },
        });
      }
      return readyRefs;
    });

    let needsRetry = false;
    for (const ref of refs) {
      if (ref.sourceFilename === null) continue;
      const result = await this.transferOne(matchId, guildId, ref, correlationId);
      if (result.terminal) terminalReached = true;
      else needsRetry = true;
    }

    if (terminalReached) {
      await this.scheduleReceiptRefresh(matchId);
    }
    if (needsRetry) {
      return new Date(Date.now() + COLLECTION_RETRY_DELAY_MS);
    }
    return undefined;
  }

  private async transferOne(
    matchId: string,
    guildId: string,
    ref: DemoReference,
    correlationId: string,
  ): Promise<{ terminal: boolean }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { dathostServerId: true },
    });
    if (match === null || match.dathostServerId === null) {
      return this.markTerminal(ref.id, 'UNAVAILABLE', 'Server already released before transfer');
    }
    const sourceFilename = ref.sourceFilename;
    if (sourceFilename === null || !this.isSafeFilename(sourceFilename)) {
      return this.markTerminal(ref.id, 'UNAVAILABLE', 'Unsafe source filename');
    }

    let response: Response;
    try {
      response = await this.dathost.downloadFile(match.dathostServerId, sourceFilename);
    } catch (error: unknown) {
      return this.retryOrFail(ref, `DatHost download failed: ${stringifyError(error)}`);
    }
    if (!response.ok || response.body === null) {
      return this.retryOrFail(ref, `DatHost download returned ${String(response.status)}`);
    }

    const storageKey = `demos/${matchId}/${String(ref.mapNumber)}/${sourceFilename}`;
    try {
      const passThrough = new PassThrough();
      const nodeStream =
        response.body instanceof ReadableStream
          ? Readable.fromWeb(response.body as ReadableStream<Uint8Array>)
          : (response.body as unknown as NodeJS.ReadableStream);
      const hash = createHash('sha256');
      let bytes = 0;
      const endPromise = new Promise<{ hash: string; bytes: number }>((resolve, reject) => {
        nodeStream.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          hash.update(chunk);
        });
        nodeStream.once('error', reject);
        nodeStream.once('end', () => resolve({ hash: hash.digest('hex'), bytes }));
      });
      nodeStream.pipe(passThrough);

      const [uploadResult, { hash: sha256Hex, bytes: transferredBytes }] = await Promise.all([
        this.storage.upload(storageKey, passThrough),
        endPromise,
      ]);

      await this.prisma.$transaction(async (transaction) => {
        await transaction.demoReference.update({
          where: { id: ref.id },
          data: {
            status: 'STORED',
            storageKey: uploadResult.storageKey,
            byteCount: BigInt(transferredBytes),
            sha256: sha256Hex,
            storedAt: new Date(),
          },
        });
        await transaction.auditEvent.create({
          data: {
            matchId,
            guildId,
            eventType: 'artifact_stored',
            result: 'success',
            correlationId,
            metadata: { mapNumber: ref.mapNumber, bytes, storageKey },
          },
        });
      });
      return { terminal: true };
    } catch (error: unknown) {
      return this.retryOrFail(ref, `Transfer failed: ${stringifyError(error)}`);
    }
  }

  private async retryOrFail(ref: DemoReference, reason: string): Promise<{ terminal: boolean }> {
    const now = new Date();
    if (ref.retryCount >= MAX_RETRIES || ref.collectionDeadlineAt <= now) {
      return this.markTerminal(ref.id, 'FAILED', reason);
    }
    await this.prisma.demoReference.update({
      where: { id: ref.id },
      data: {
        status: 'SOURCE_READY',
        retryCount: { increment: 1 },
        failureReason: reason,
      },
    });
    return { terminal: false };
  }

  private async markTerminal(
    id: string,
    status: 'UNAVAILABLE' | 'FAILED',
    reason: string,
  ): Promise<{ terminal: true }> {
    await this.prisma.demoReference.update({
      where: { id },
      data: { status, failureReason: reason },
    });
    return { terminal: true };
  }

  private isSafeFilename(filename: string | null): boolean {
    if (filename === null) return false;
    return /^[A-Za-z0-9_.-]{1,255}$/u.test(filename) && !filename.includes('..');
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
