import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ProvisioningOrchestrator } from '../orchestrator/provisioning.js';
import type { DatHostClient } from '../../../integrations/dathost/client.js';
import { buildMatchZyConfig } from '../integrations/matchzy/config-builder.js';
import { renderMatchZyCommand } from '../integrations/matchzy/commands.js';
import { assertCompetitiveBo1FiveVFive, gameProfileSchema } from '../domain/game-profile.js';
import type { CredentialCipher } from './credential-cipher.js';
import type { MatchCredentialService } from './match-credential-service.js';
import { scheduleJob } from '../../../database/schedule-job.js';

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
      include: { players: true, profile: true },
    });
    if (match === null) throw new Error('Match not found');
    if (!['TEAMS_LOCKED', 'SERVER_PROVISIONING', 'SERVER_BOOTING'].includes(match.state)) {
      this.logger.warn(
        { matchId, state: match.state },
        'Ignoring provision job for unexpected match state',
      );
      return;
    }
    if (match.dathostTemplateServerId === null) {
      throw new Error('Match is missing its DatHost template snapshot');
    }

    const context = {
      matchId,
      guildId: match.guildId,
      templateServerId: match.dathostTemplateServerId,
      location: match.serverLocation,
      slots: match.profile.serverSlots,
    };

    let expectedVersion = match.version;
    if (match.state === 'TEAMS_LOCKED') {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.match.updateMany({
          where: { id: matchId, state: 'TEAMS_LOCKED', version: match.version },
          data: { state: 'SERVER_PROVISIONING', version: { increment: 1 } },
        });
        if (updated.count !== 1) return false;
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: 'TEAMS_LOCKED',
            toState: 'SERVER_PROVISIONING',
            source: 'WORKER_PROVISION',
          },
        });
        return true;
      });
      if (!claimed) return;
      expectedVersion = match.version + 1;
    }

    if (match.state === 'SERVER_BOOTING' && match.dathostServerId !== null) {
      await this.dathost.startServer(match.dathostServerId);
      await scheduleJob(this.prisma, {
        type: 'POLL_SERVER_BOOT',
        idempotencyKey: `poll-boot:${matchId}:${match.dathostServerId}`,
        matchId,
        payload: { matchId, serverId: match.dathostServerId, startedAt: Date.now() },
      });
      return;
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

    const claimed = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.match.updateMany({
        where: { id: matchId, state: 'SERVER_PROVISIONING', version: expectedVersion },
        data: {
          dathostServerId: server.id,
          encryptedRconPassword: encryptedRcon,
          encryptedJoinPassword: encryptedJoin,
          state: 'SERVER_BOOTING',
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const current = await transaction.match.findUnique({
          where: { id: matchId },
          select: { state: true, dathostServerId: true },
        });
        if (
          current !== null &&
          ['FINISHED', 'CANCELED', 'FAILED'].includes(current.state) &&
          current.dathostServerId === null
        ) {
          await transaction.match.update({
            where: { id: matchId },
            data: {
              dathostServerId: server.id,
              encryptedRconPassword: encryptedRcon,
              encryptedJoinPassword: encryptedJoin,
              cleanupStatus: 'PENDING',
              guildSlotActive: true,
            },
          });
          await scheduleJob(transaction, {
            type: 'CLEANUP_MATCH',
            idempotencyKey: `cleanup:${matchId}`,
            matchId,
            payload: { matchId },
          });
        }
        return false;
      }
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'SERVER_PROVISIONING',
          toState: 'SERVER_BOOTING',
          source: 'WORKER_PROVISION',
        },
      });
      return true;
    });
    if (!claimed) return;

    this.logger.info({ matchId, serverId: server.id }, 'Starting DatHost duplicate');
    await this.dathost.startServer(server.id);

    await scheduleJob(this.prisma, {
      matchId,
      type: 'POLL_SERVER_BOOT',
      idempotencyKey: `poll-boot:${matchId}:${server.id}`,
      payload: { matchId, serverId: server.id, startedAt: Date.now() },
    });
  }

  public async runBootPollJob(matchId: string, serverId: string, startedAt: number): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { players: true, profile: true },
    });
    if (match === null) throw new Error('Match not found');
    if (match.dathostServerId !== serverId) throw new Error('Boot poll server ID mismatch');
    if (match.state === 'MATCH_LOADED') {
      await scheduleJob(this.prisma, {
        type: 'VOICE_RECONCILE',
        idempotencyKey: `voice:${matchId}:loaded`,
        matchId,
        payload: { matchId },
      });
      return;
    }
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
      const bootClaimed = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.match.updateMany({
          where: { id: matchId, state: 'SERVER_BOOTING', version: match.version },
          data: { state: 'SERVER_READY', version: { increment: 1 } },
        });
        if (updated.count !== 1) return false;
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: 'SERVER_BOOTING',
            toState: 'SERVER_READY',
            source: 'WORKER_BOOT_POLL',
          },
        });
        return true;
      });
      if (!bootClaimed) return;
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
    const profile = gameProfileSchema.parse({
      key: match.profile.key,
      enabled: match.profile.enabled,
      playersPerTeam: match.profile.playersPerTeam,
      numMaps: match.profile.numMaps,
      serverSlots: match.profile.serverSlots,
      mapAllowlist: match.mapAllowlist,
      matchzy: {
        ...(match.profile.matchzyOptions as object),
        cvars: match.profile.allowedCvars,
      },
    });
    assertCompetitiveBo1FiveVFive(profile);

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
      minPlayersToReady: profile.matchzy.minPlayersToReady,
      mapSide: profile.matchzy.knifeRound ? 'knife' : profile.matchzy.mapSide,
      ...(profile.matchzy.wingman === true ? { wingman: true } : {}),
      cvars: profile.matchzy.cvars,
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

    const loaded = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.match.updateMany({
        where: {
          id: matchId,
          state: 'SERVER_READY',
          version: match.version + (match.state === 'SERVER_BOOTING' ? 1 : 0),
        },
        data: {
          state: 'MATCH_LOADED',
          dathostIp: ip,
          dathostPort: ports.game,
          matchzyConfig: built.config as unknown as object,
          matchzyConfigHash: built.sha256,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return false;
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'SERVER_READY',
          toState: 'MATCH_LOADED',
          source: 'WORKER_BOOT_POLL',
        },
      });
      return true;
    });
    if (!loaded) return;

    this.logger.info({ matchId, serverId, ip, port: ports.game }, 'MatchZy config loaded');

    await scheduleJob(this.prisma, {
      matchId,
      type: 'VOICE_RECONCILE',
      idempotencyKey: `voice:${matchId}:loaded`,
      payload: { matchId },
    });
  }
}
