import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostServerReader } from '../../../integrations/dathost/client.js';

export interface GameServerDiagnosticCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface GameServerDiagnosticsReport {
  runAt: Date;
  mode: 'persisted' | 'live';
  settings: GameServerDiagnosticCheck[];
  aggregate: GameServerDiagnosticCheck[];
  servers: Array<{
    id: string;
    displayName: string;
    checks: GameServerDiagnosticCheck[];
  }>;
}

export class GameServerDiagnosticsService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly dathost: DatHostServerReader,
  ) {}

  public async runPersisted(guildId: string): Promise<GameServerDiagnosticsReport> {
    const [settings, servers] = await Promise.all([
      this.prisma.gameServerSettings.findUnique({ where: { guildId } }),
      this.prisma.gameServer.findMany({
        where: { guildId },
        include: { snapshot: true, cards: { select: { id: true } } },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
    ]);
    return {
      runAt: new Date(),
      mode: 'persisted',
      settings: this.settingsChecks(settings),
      aggregate: this.aggregateChecks(settings, servers),
      servers: servers.map((server) => ({
        id: server.id,
        displayName: server.displayName,
        checks: this.serverChecks(server, settings),
      })),
    };
  }

  public async runLive(guildId: string): Promise<GameServerDiagnosticsReport> {
    const persisted = await this.runPersisted(guildId);
    const serverChecks = await Promise.all(
      persisted.servers.map(async (entry) => {
        const server = await this.prisma.gameServer.findUnique({
          where: { id: entry.id },
          select: { providerServerId: true },
        });
        if (server === null) return { ...entry, checks: entry.checks };
        const reachable = await this.dathost
          .getServer(server.providerServerId)
          .then(() => true)
          .catch(() => false);
        const checks: GameServerDiagnosticCheck[] = [
          ...entry.checks,
          {
            label: 'DatHost reachability',
            ok: reachable,
            ...(reachable ? {} : { detail: 'DatHost server object is unreachable' }),
          },
        ];
        return { ...entry, checks };
      }),
    );
    return {
      ...persisted,
      runAt: new Date(),
      mode: 'live',
      servers: serverChecks,
    };
  }

  private settingsChecks(
    settings: { enabled: boolean; panelChannelId: string | null } | null,
  ): GameServerDiagnosticCheck[] {
    if (settings === null) {
      return [{ label: 'Module settings', ok: false, detail: 'Not configured' }];
    }
    const checks: GameServerDiagnosticCheck[] = [
      {
        label: 'Module enabled',
        ok: settings.enabled,
        detail: settings.enabled ? 'Enabled' : 'Disabled',
      },
    ];
    if (settings.panelChannelId === null) {
      checks.push({
        label: 'Panel destination',
        ok: false,
        detail: 'No text channel configured',
      });
    } else {
      checks.push({ label: 'Panel destination', ok: true, detail: 'Text channel configured' });
    }
    return checks;
  }

  private aggregateChecks(
    settings: { enabled: boolean } | null,
    servers: Array<{ enabled: boolean; public: boolean }>,
  ): GameServerDiagnosticCheck[] {
    const enabled = servers.filter((server) => server.enabled).length;
    const publicServers = servers.filter((server) => server.enabled && server.public).length;
    return [
      {
        label: 'Module state',
        ok: settings?.enabled === true,
        detail:
          settings?.enabled === true ? 'Enabled' : settings === null ? 'Unconfigured' : 'Disabled',
      },
      {
        label: 'Registered servers',
        ok: true,
        detail: `${String(servers.length)} registration${servers.length === 1 ? '' : 's'}`,
      },
      {
        label: 'Polling servers',
        ok: enabled > 0 || servers.length === 0,
        detail: `${String(enabled)} enabled`,
      },
      {
        label: 'Public servers',
        ok: true,
        detail: `${String(publicServers)} public`,
      },
    ];
  }

  private serverChecks(
    server: {
      id: string;
      enabled: boolean;
      public: boolean;
      snapshot: {
        hostingState: string;
        stale: boolean;
        consecutiveFailures: number;
        lastSuccessfulAt: Date | null;
        lastError: string | null;
      } | null;
      cards: Array<{ id: string }>;
    },
    settings: { enabled: boolean } | null,
  ): GameServerDiagnosticCheck[] {
    const checks: GameServerDiagnosticCheck[] = [
      {
        label: 'Polling',
        ok: server.enabled,
        detail: server.enabled ? 'Enabled' : 'Disabled',
      },
      {
        label: 'Public visibility',
        ok: server.public,
        detail: server.public ? 'Public' : 'Private',
      },
    ];
    if (server.public && server.cards.length === 0) {
      checks.push({
        label: 'Panel card',
        ok: false,
        detail: 'Public but no Discord card is registered',
      });
    } else if (server.public) {
      checks.push({ label: 'Panel card', ok: true, detail: 'Registered' });
    }
    if (server.snapshot === null) {
      checks.push({ label: 'Snapshot', ok: false, detail: 'No observation yet' });
    } else {
      if (server.snapshot.stale) {
        checks.push({ label: 'Snapshot freshness', ok: false, detail: 'Stale' });
      } else {
        checks.push({
          label: 'Snapshot freshness',
          ok: true,
          detail:
            server.snapshot.lastSuccessfulAt === null
              ? 'No successful observation yet'
              : `Last success ${server.snapshot.lastSuccessfulAt.toISOString()}`,
        });
      }
      if (server.snapshot.consecutiveFailures > 0) {
        checks.push({
          label: 'Consecutive failures',
          ok: server.snapshot.consecutiveFailures < 3,
          detail: `${String(server.snapshot.consecutiveFailures)} failure(s)${server.snapshot.lastError ? `: ${server.snapshot.lastError.slice(0, 120)}` : ''}`,
        });
      }
      checks.push({
        label: 'Hosting state',
        ok: server.snapshot.hostingState !== 'UNKNOWN',
        detail: server.snapshot.hostingState,
      });
    }
    if (settings?.enabled === false) {
      checks.push({
        label: 'Module status',
        ok: false,
        detail: 'Game Servers module is disabled',
      });
    }
    return checks;
  }
}
