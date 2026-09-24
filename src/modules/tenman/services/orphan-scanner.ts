import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostServer } from '../integrations/dathost/schemas.js';

const OWNERSHIP_PREFIX = 'tenman:';

export interface OrphanScannerDatHost {
  listServers(): Promise<readonly DatHostServer[]>;
}

export interface OrphanReport {
  serverId: string;
  serverName: string;
  userData: string | null;
  disposition: 'accounted' | 'adoption_candidate' | 'orphan' | 'unknown';
  matchId: string | null;
  reason: string;
}

export class OrphanScanner {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly dathost: OrphanScannerDatHost,
    private readonly templateServerIds: ReadonlySet<string>,
  ) {}

  public async scan(): Promise<readonly OrphanReport[]> {
    const servers = await this.dathost.listServers();
    const reports: OrphanReport[] = [];
    for (const server of servers) {
      if (this.templateServerIds.has(server.id)) continue;
      const report = await this.evaluate(server);
      reports.push(report);
      await this.persistReport(report);
    }
    return reports;
  }

  private async evaluate(server: DatHostServer): Promise<OrphanReport> {
    const userData = server.user_data ?? null;
    const base = {
      serverId: server.id,
      serverName: server.name,
      userData,
      matchId: null as string | null,
    };

    if (userData === null || !userData.startsWith(OWNERSHIP_PREFIX)) {
      return { ...base, disposition: 'unknown', reason: 'No competitive ownership marker' };
    }

    const parts = userData.split(':');
    if (parts.length < 2) {
      return { ...base, disposition: 'unknown', reason: 'Malformed ownership marker' };
    }
    const matchId = parts[1];
    if (matchId === undefined || matchId.length === 0) {
      return { ...base, disposition: 'unknown', reason: 'Malformed ownership marker' };
    }

    const reportBase = { ...base, matchId };

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, dathostServerId: true, cleanupStatus: true },
    });

    if (match === null) {
      return {
        ...reportBase,
        disposition: 'orphan',
        reason: 'No matching match record; operator review required before deletion',
      };
    }

    if (match.dathostServerId === server.id) {
      return { ...reportBase, disposition: 'accounted', reason: 'Server is recorded on the match' };
    }

    const attempt = await this.prisma.provisioningAttempt.findFirst({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, dathostServerId: true, status: true },
    });

    if (attempt?.dathostServerId === server.id) {
      return {
        ...reportBase,
        disposition: 'accounted',
        reason: 'Server is recorded on the latest provisioning attempt',
      };
    }

    if (match.cleanupStatus === 'COMPLETE' || match.cleanupStatus === 'NOT_REQUIRED') {
      return {
        ...reportBase,
        disposition: 'orphan',
        reason: 'Match cleanup is complete but server still exists; operator review required',
      };
    }

    return {
      ...reportBase,
      disposition: 'adoption_candidate',
      reason: 'Server marker matches active match but DB records a different server ID',
    };
  }

  private async persistReport(report: OrphanReport): Promise<void> {
    if (report.matchId === null) return;
    await this.prisma.reconciliationEvent.create({
      data: {
        matchId: report.matchId,
        observation: {
          source: 'ORPHAN_SCAN',
          serverId: report.serverId,
          serverName: report.serverName,
          userData: report.userData,
          disposition: report.disposition,
        },
        result: report.disposition,
      },
    });
  }
}
