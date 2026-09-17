import { randomBytes, randomUUID } from 'node:crypto';
import type { DatHostServer } from '../integrations/dathost/schemas.js';
import {
  reconcileDuplicate,
  type DuplicateResolution,
} from '../integrations/dathost/duplicate-recovery.js';

export interface ProvisioningContext {
  matchId: string;
  guildId: string;
  templateServerId: string;
  location: string;
  slots: number;
}

export interface ProvisioningAttemptRecord {
  id: string;
  matchId: string;
  status:
    | 'DUPLICATE_REQUEST_PENDING'
    | 'DUPLICATE_OUTCOME_UNKNOWN'
    | 'SERVER_IDENTIFIED'
    | 'AMBIGUOUS';
  provisionalName: string;
  ownershipMarker: string;
  templateServerId: string;
  location: string;
  requestStartedAt: Date;
  requestFinishedAt: Date;
  serverId: string | null;
}

export interface ProvisioningRepository {
  findUnresolved(matchId: string): Promise<ProvisioningAttemptRecord | null>;
  createIntent(attempt: ProvisioningAttemptRecord): Promise<void>;
  markUnknown(attemptId: string, finishedAt: Date, reason: string): Promise<void>;
  identify(attemptId: string, server: DatHostServer, evidence: string): Promise<void>;
  markAmbiguous(attemptId: string, candidates: readonly DatHostServer[]): Promise<void>;
}

export interface ProvisioningDatHost {
  createProvisionalServer(
    fields: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatHostServer>;
  duplicateServer(
    templateId: string,
    location: string,
    destinationServerId: string,
  ): Promise<DatHostServer>;
  listServers(): Promise<DatHostServer[]>;
  updateServer(
    serverId: string,
    fields: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatHostServer>;
}

export class ProvisioningOrchestrator {
  public constructor(
    private readonly repository: ProvisioningRepository,
    private readonly dathost: ProvisioningDatHost,
    private readonly templateServerIds: ReadonlySet<string>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async provision(context: ProvisioningContext): Promise<DatHostServer | null> {
    if (this.templateServerIds.has(context.matchId)) throw new Error('Invalid match identity');
    const existing = await this.repository.findUnresolved(context.matchId);
    if (existing !== null) {
      if (existing.status === 'DUPLICATE_OUTCOME_UNKNOWN' || existing.status === 'AMBIGUOUS') {
        await this.reconcile(existing);
        return null;
      }
      if (existing.serverId !== null) return this.duplicateIntoDestination(existing, context.slots);
      return this.reconcile(existing);
    }

    const startedAt = this.now();
    const attemptId = randomUUID();
    const attempt: ProvisioningAttemptRecord = {
      id: attemptId,
      matchId: context.matchId,
      status: 'DUPLICATE_REQUEST_PENDING',
      provisionalName: `10man-${context.matchId.slice(0, 8)}-${attemptId.slice(0, 8)}`,
      ownershipMarker: `tenman:${context.matchId}:${attemptId}`,
      templateServerId: context.templateServerId,
      location: context.location,
      requestStartedAt: startedAt,
      requestFinishedAt: startedAt,
      serverId: null,
    };
    await this.repository.createIntent(attempt);
    let destination: DatHostServer;
    try {
      destination = await this.dathost.createProvisionalServer({
        game: 'cs2',
        name: attempt.provisionalName,
        user_data: attempt.ownershipMarker,
        location: attempt.location,
        deletion_protection: false,
      });
    } catch (error: unknown) {
      await this.repository.markUnknown(
        attempt.id,
        this.now(),
        error instanceof Error ? error.message : 'Unknown provisional server outcome',
      );
      return null;
    }
    await this.repository.identify(attempt.id, destination, 'PROVISIONAL_SERVER_RESPONSE');
    return this.duplicateIntoDestination(
      { ...attempt, status: 'SERVER_IDENTIFIED', serverId: destination.id },
      context.slots,
    );
  }

  public async reconcile(attempt: ProvisioningAttemptRecord): Promise<DatHostServer | null> {
    if (attempt.status === 'AMBIGUOUS') return null;
    const servers = await this.dathost.listServers();
    const resolution: DuplicateResolution = reconcileDuplicate(
      {
        persistedServerId: attempt.serverId,
        ownershipMarker: attempt.ownershipMarker,
        provisionalName: attempt.provisionalName,
        location: attempt.location,
        requestStartedAt: attempt.requestStartedAt,
        requestFinishedAt: attempt.requestFinishedAt,
        templateServerIds: this.templateServerIds,
      },
      servers,
    );
    if (resolution.status === 'PENDING') return null;
    if (resolution.status === 'AMBIGUOUS') {
      await this.repository.markAmbiguous(attempt.id, resolution.candidates);
      return null;
    }
    await this.repository.identify(attempt.id, resolution.server, resolution.evidence);
    return resolution.server;
  }

  private async duplicateIntoDestination(
    attempt: ProvisioningAttemptRecord,
    slots: number,
  ): Promise<DatHostServer | null> {
    if (attempt.serverId === null || this.templateServerIds.has(attempt.serverId)) {
      throw new Error('Safe duplicate destination is not persisted');
    }
    let duplicate: DatHostServer;
    try {
      duplicate = await this.dathost.duplicateServer(
        attempt.templateServerId,
        attempt.location,
        attempt.serverId,
      );
    } catch (error: unknown) {
      await this.repository.markUnknown(
        attempt.id,
        this.now(),
        error instanceof Error ? error.message : 'Unknown duplicate outcome',
      );
      return null;
    }
    if (duplicate.id !== attempt.serverId)
      throw new Error('DatHost returned an unexpected destination');
    await this.repository.identify(attempt.id, duplicate, 'DUPLICATE_RESPONSE');
    return this.configure(duplicate, attempt, slots);
  }

  private configure(
    server: DatHostServer,
    attempt: ProvisioningAttemptRecord,
    slots: number,
  ): Promise<DatHostServer> {
    if (this.templateServerIds.has(server.id))
      throw new Error('Refusing to configure protected template');
    return this.dathost.updateServer(server.id, {
      name: attempt.provisionalName,
      user_data: attempt.ownershipMarker,
      location: attempt.location,
      'cs2_settings.slots': slots,
      'cs2_settings.enable_gotv': true,
      'cs2_settings.private_server': true,
      'cs2_settings.rcon': randomBytes(32).toString('base64url'),
      'cs2_settings.password': randomBytes(24).toString('base64url'),
      autostop: true,
      autostop_minutes: 15,
      deletion_protection: false,
    });
  }
}
