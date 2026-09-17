import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  ProvisioningAttemptRecord,
  ProvisioningRepository,
} from '../orchestrator/provisioning.js';
import type { DatHostServer } from '../integrations/dathost/schemas.js';

type ProvisioningStatus = ProvisioningAttemptRecord['status'];

const UNRESOLVED_STATUSES: ProvisioningStatus[] = [
  'DUPLICATE_REQUEST_PENDING',
  'DUPLICATE_OUTCOME_UNKNOWN',
  'SERVER_IDENTIFIED',
  'AMBIGUOUS',
];

function assertUnresolvedStatus(status: string): asserts status is ProvisioningStatus {
  if (!UNRESOLVED_STATUSES.includes(status as ProvisioningStatus)) {
    throw new Error(`Provisioning attempt is not unresolved: ${status}`);
  }
}

function readOwnershipMarker(record: { candidateEvidence: unknown }): string {
  const evidence = record.candidateEvidence;
  if (
    typeof evidence === 'object' &&
    evidence !== null &&
    'ownershipMarker' in evidence &&
    typeof evidence.ownershipMarker === 'string' &&
    evidence.ownershipMarker.length > 0
  ) {
    return evidence.ownershipMarker;
  }
  throw new Error('Provisioning attempt is missing ownership marker');
}

export class PrismaProvisioningRepository implements ProvisioningRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findUnresolved(matchId: string): Promise<ProvisioningAttemptRecord | null> {
    const record = await this.prisma.provisioningAttempt.findFirst({
      where: { matchId, status: { in: UNRESOLVED_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (record === null) return null;
    assertUnresolvedStatus(record.status);
    if (record.requestStartedAt === null || record.requestFinishedAt === null) {
      throw new Error('Unresolved provisioning attempt is missing request timestamps');
    }
    return {
      id: record.id,
      matchId: record.matchId,
      status: record.status,
      provisionalName: record.provisionalName,
      ownershipMarker: readOwnershipMarker(record),
      templateServerId: record.requestedTemplateId,
      location: record.requestedLocation,
      requestStartedAt: record.requestStartedAt,
      requestFinishedAt: record.requestFinishedAt,
      serverId: record.dathostServerId,
    };
  }

  public async createIntent(attempt: ProvisioningAttemptRecord): Promise<void> {
    await this.prisma.provisioningAttempt.create({
      data: {
        id: attempt.id,
        matchId: attempt.matchId,
        status: attempt.status,
        provisionalName: attempt.provisionalName,
        requestedTemplateId: attempt.templateServerId,
        requestedLocation: attempt.location,
        requestStartedAt: attempt.requestStartedAt,
        requestFinishedAt: attempt.requestFinishedAt,
        dathostServerId: attempt.serverId,
        candidateEvidence: { ownershipMarker: attempt.ownershipMarker } as Prisma.InputJsonValue,
      },
    });
  }

  public async markUnknown(attemptId: string, finishedAt: Date, reason: string): Promise<void> {
    const evidence = await this.mergedEvidence(attemptId, { reason });
    await this.prisma.provisioningAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'DUPLICATE_OUTCOME_UNKNOWN',
        requestFinishedAt: finishedAt,
        candidateEvidence: evidence as Prisma.InputJsonValue,
      },
    });
  }

  public async identify(attemptId: string, server: DatHostServer, evidence: string): Promise<void> {
    const candidateEvidence = await this.mergedEvidence(attemptId, {
      evidence,
      server: { id: server.id },
    });
    await this.prisma.provisioningAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'SERVER_IDENTIFIED',
        dathostServerId: server.id,
        requestFinishedAt: new Date(),
        candidateEvidence: candidateEvidence as Prisma.InputJsonValue,
      },
    });
  }

  public async markAmbiguous(
    attemptId: string,
    candidates: readonly DatHostServer[],
  ): Promise<void> {
    const evidence = await this.mergedEvidence(attemptId, {
      candidates: candidates.map((server) => server.id),
    });
    await this.prisma.provisioningAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'AMBIGUOUS',
        requestFinishedAt: new Date(),
        candidateEvidence: evidence as Prisma.InputJsonValue,
      },
    });
  }

  private async mergedEvidence(
    attemptId: string,
    additional: Record<string, Prisma.InputJsonValue>,
  ): Promise<Record<string, Prisma.InputJsonValue>> {
    const record = await this.prisma.provisioningAttempt.findUnique({
      where: { id: attemptId },
      select: { candidateEvidence: true },
    });
    const existing = (record?.candidateEvidence ?? {}) as Record<string, Prisma.InputJsonValue>;
    return { ...existing, ...additional };
  }
}
