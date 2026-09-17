import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ProvisioningOrchestrator } from '../orchestrator/provisioning.js';
import type { DatHostClient } from '../integrations/dathost/client.js';
import { buildMatchZyConfig } from '../integrations/matchzy/config-builder.js';
import { renderMatchZyCommand } from '../integrations/matchzy/commands.js';
import type { CredentialCipher } from './credential-cipher.js';
import type { MatchCredentialService } from './match-credential-service.js';

export class ProvisioningService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly orchestrator: ProvisioningOrchestrator,
    private readonly dathost: DatHostClient,
    private readonly credentials: MatchCredentialService,
    private readonly cipher: CredentialCipher,
    private readonly publicBaseUrl: URL,
    private readonly logger: Logger,
  ) {}

  public async runProvisionJob(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { players: true, profile: true, guild: true },
    });
    if (match === null) throw new Error('Match not found');
    if (!['TEAMS_LOCKED', 'SERVER_PROVISIONING'].includes(match.state)) {
      this.logger.warn(
        { matchId, state: match.state },
        'Ignoring provision job for unexpected match state',
      );
      return;
    }

    if (match.guild.dathostTemplateServerId === null) {
      throw new Error('Guild has no DatHost template server configured');
    }
    const context = {
      matchId,
      guildId: match.guildId,
      templateServerId: match.guild.dathostTemplateServerId,
      location: match.guild.defaultServerLocation ?? 'dallas',
      slots: match.profile.serverSlots,
    };

    if (match.state === 'TEAMS_LOCKED') {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.match.update({
          where: { id: matchId },
          data: { state: 'SERVER_PROVISIONING' },
        });
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: 'TEAMS_LOCKED',
            toState: 'SERVER_PROVISIONING',
            source: 'WORKER_PROVISION',
          },
        });
      });
    }

    const server = await this.orchestrator.provision(context);
    if (server === null) {
      const latest = await this.prisma.provisioningAttempt.findFirst({
        where: { matchId, status: { in: ['DUPLICATE_OUTCOME_UNKNOWN', 'AMBIGUOUS'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (latest?.status === 'AMBIGUOUS')
        throw new Error('Ambiguous DatHost candidate, requires operator review');
      throw new Error('DatHost duplicate outcome is uncertain, will reconcile');
    }

    const rcon = randomBytes(32).toString('base64url');
    const password = randomBytes(24).toString('base64url');
    await this.dathost.updateServer(server.id, {
      'cs2_settings.rcon': rcon,
      'cs2_settings.password': password,
    });

    const encryptedRcon = this.cipher.encrypt(rcon, `rcon:${matchId}:${server.id}`);
    const encryptedJoin = this.cipher.encrypt(password, `join:${matchId}:${server.id}`);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.match.update({
        where: { id: matchId },
        data: {
          dathostServerId: server.id,
          encryptedRconPassword: encryptedRcon,
          encryptedJoinPassword: encryptedJoin,
          state: 'SERVER_BOOTING',
        },
      });
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'SERVER_PROVISIONING',
          toState: 'SERVER_BOOTING',
          source: 'WORKER_PROVISION',
        },
      });
    });

    this.logger.info({ matchId, serverId: server.id }, 'Starting DatHost duplicate');
    await this.dathost.startServer(server.id);

    await this.prisma.job.create({
      data: {
        matchId,
        type: 'POLL_SERVER_BOOT',
        idempotencyKey: `poll-boot:${matchId}:${server.id}`,
        payload: { matchId, serverId: server.id, startedAt: Date.now() },
      },
    });
  }

  public async runBootPollJob(matchId: string, serverId: string, startedAt: number): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { players: true, profile: true, guild: true },
    });
    if (match === null) throw new Error('Match not found');
    if (match.dathostServerId !== serverId) throw new Error('Boot poll server ID mismatch');
    if (match.state === 'MATCH_LOADED') return;
    if (!['SERVER_BOOTING', 'SERVER_READY'].includes(match.state)) {
      throw new Error(`Boot poll cannot run from ${match.state}`);
    }

    const server = await this.dathost.getServer(serverId);
    if (server === null) throw new Error('DatHost server disappeared during boot');
    if (server.booting) {
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        throw new Error('DatHost server boot timed out');
      }
      throw new Error('Server still booting');
    }

    const ip = server.ip;
    const ports = server.ports;
    if (ip === undefined || ports === undefined) {
      throw new Error('DatHost server is not reporting connection details');
    }

    if (match.state === 'SERVER_BOOTING') {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.match.update({ where: { id: matchId }, data: { state: 'SERVER_READY' } });
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: 'SERVER_BOOTING',
            toState: 'SERVER_READY',
            source: 'WORKER_BOOT_POLL',
          },
        });
      });
    }

    const team1 = match.players.filter((player) => player.team === 'TEAM_1');
    const team2 = match.players.filter((player) => player.team === 'TEAM_2');
    if (
      team1.length !== match.profile.playersPerTeam ||
      team2.length !== match.profile.playersPerTeam
    ) {
      throw new Error('Roster does not match profile');
    }
    if (match.selectedMap === null) throw new Error('No map selected');

    const configToken = await this.credentials.issue(
      matchId,
      'CONFIG_READ',
      serverId,
      60 * 60 * 1000,
    );
    const eventToken = await this.credentials.issue(
      matchId,
      'EVENT_WRITE',
      serverId,
      4 * 60 * 60 * 1000,
    );
    const configUrl = new URL(
      `/internal/matches/${matchId}/matchzy-config`,
      this.publicBaseUrl,
    ).toString();
    const remoteLogUrl = new URL(`/webhooks/matchzy/${matchId}`, this.publicBaseUrl).toString();

    const built = buildMatchZyConfig({
      matchId: match.matchzyMatchId,
      mapName: match.selectedMap,
      playersPerTeam: match.profile.playersPerTeam,
      team1Name: 'Team 1',
      team2Name: 'Team 2',
      players: match.players.map((player) => ({
        steamId64: player.steamId64,
        displayName: player.displayNameSnapshot,
        team: player.team as 'TEAM_1' | 'TEAM_2',
      })),
      minPlayersToReady: match.profile.playersPerTeam,
      cvars: match.profile.allowedCvars as Record<string, string>,
      remoteLogUrl,
      remoteLogHeaderKey: 'x-matchzy-token',
      remoteLogHeaderValue: eventToken.token,
    });

    const loadCommand = renderMatchZyCommand({
      type: 'LOAD_MATCH',
      url: configUrl,
      headerName: 'x-matchzy-token',
      headerValue: configToken.token,
    });

    await this.dathost.sendConsole(serverId, loadCommand);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.match.update({
        where: { id: matchId },
        data: {
          state: 'MATCH_LOADED',
          dathostIp: ip,
          dathostPort: ports.game,
          matchzyConfig: built.config as unknown as object,
          matchzyConfigHash: built.sha256,
        },
      });
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'SERVER_READY',
          toState: 'MATCH_LOADED',
          source: 'WORKER_BOOT_POLL',
        },
      });
    });

    this.logger.info({ matchId, serverId, ip, port: ports.game }, 'MatchZy config loaded');

    await this.prisma.job.create({
      data: {
        matchId,
        type: 'VOICE_RECONCILE',
        idempotencyKey: `voice:${matchId}:loaded`,
        payload: { matchId },
      },
    });
  }
}
