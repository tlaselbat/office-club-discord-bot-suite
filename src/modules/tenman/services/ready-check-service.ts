import { randomInt } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { RandomTeamBalancer } from '../domain/teams.js';
import { schedulePhaseTimeout } from './phase-timeout-job.js';
import { assertSupportedFormationPolicy } from './formation-policy.js';

export class ReadyCheckService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async setReady(
    matchId: string,
    discordUserId: string,
    expectedVersion: number,
    ready: boolean,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: {
          players: true,
          profile: { select: { playersPerTeam: true, mapAllowlist: true } },
          guild: {
            select: {
              readyTimeoutSeconds: true,
              captainPolicy: true,
              teamSelectionMode: true,
              mapSelectionMode: true,
            },
          },
        },
      });
      if (match === null || match.state !== 'READY_CHECK') {
        throw new PublicError('READY_UNAVAILABLE', 'Ready check is no longer active.');
      }
      if (
        match.version !== expectedVersion ||
        match.phaseDeadlineAt === null ||
        match.phaseDeadlineAt <= new Date()
      ) {
        throw new PublicError('STALE_COMPONENT', 'This ready control is stale.');
      }
      const changed = await transaction.matchPlayer.updateMany({
        where: { matchId, discordUserId },
        data: { readyState: ready ? 'READY' : 'NOT_READY' },
      });
      if (changed.count !== 1)
        throw new PublicError('NOT_PARTICIPANT', 'You are not a participant.');
      await dashboardRefresh(transaction, matchId);
      const allReady = match.players.every((player) =>
        player.discordUserId === discordUserId ? ready : player.readyState === 'READY',
      );
      if (!allReady) return;
      assertSupportedFormationPolicy(match.guild);
      if (match.players.length !== match.profile.playersPerTeam * 2) {
        throw new PublicError(
          'INVALID_ROSTER',
          'The ready roster does not match the game profile.',
        );
      }
      const deadline = new Date(Date.now() + match.guild.readyTimeoutSeconds * 1000);
      const randomTeams = match.guild.teamSelectionMode === 'RANDOM';
      const randomMap = match.guild.mapSelectionMode === 'RANDOM';
      const nextState = randomTeams ? (randomMap ? 'TEAMS_LOCKED' : 'MAP_VETO') : 'TEAM_SELECTION';
      const selectedMap = randomMap ? pickRandomMap(match.profile.mapAllowlist) : null;
      if (randomTeams) {
        const assignment = new RandomTeamBalancer().generate(match.players);
        await transaction.matchPlayer.updateMany({
          where: { matchId },
          data: { captainTeam: null, draftOrder: null, team: 'UNASSIGNED' },
        });
        await Promise.all([
          ...assignment.team1.map((player) =>
            transaction.matchPlayer.update({
              where: { matchId_discordUserId: { matchId, discordUserId: player.discordUserId } },
              data: { team: 'TEAM_1' },
            }),
          ),
          ...assignment.team2.map((player) =>
            transaction.matchPlayer.update({
              where: { matchId_discordUserId: { matchId, discordUserId: player.discordUserId } },
              data: { team: 'TEAM_2' },
            }),
          ),
        ]);
        // Captain veto still needs an actor. Pick one from each already-random
        // team; no draft picks are created because teams are locked by policy.
        if (!randomMap) {
          const team1Captain = assignment.team1[randomInt(assignment.team1.length)];
          const team2Captain = assignment.team2[randomInt(assignment.team2.length)];
          if (team1Captain === undefined || team2Captain === undefined)
            throw new Error('Random team assignment did not produce two teams');
          await Promise.all([
            transaction.matchPlayer.update({
              where: {
                matchId_discordUserId: { matchId, discordUserId: team1Captain.discordUserId },
              },
              data: { captainTeam: 'TEAM_1' },
            }),
            transaction.matchPlayer.update({
              where: {
                matchId_discordUserId: { matchId, discordUserId: team2Captain.discordUserId },
              },
              data: { captainTeam: 'TEAM_2' },
            }),
          ]);
        }
      }
      const updated = await transaction.match.updateMany({
        where: { id: matchId, state: 'READY_CHECK', version: expectedVersion },
        data: {
          state: nextState,
          selectedMap,
          phaseDeadlineAt: nextState === 'TEAMS_LOCKED' ? null : deadline,
          phaseGeneration: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new PublicError('STALE_COMPONENT', 'This ready control is stale.');
      if (nextState !== 'TEAMS_LOCKED')
        await schedulePhaseTimeout(
          transaction,
          matchId,
          nextState,
          expectedVersion + 1,
          deadline,
          correlationId,
        );
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'READY_CHECK',
          toState: nextState,
          source: randomTeams ? 'READY_CHECK_RANDOM_TEAMS' : 'READY_CHECK_COMPLETE',
        },
      });
      if (nextState === 'TEAMS_LOCKED') {
        await transaction.job.upsert({
          where: { idempotencyKey: `provision:${matchId}` },
          update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
          create: {
            matchId,
            type: 'PROVISION_SERVER',
            idempotencyKey: `provision:${matchId}`,
            payload: { matchId },
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: discordUserId,
          eventType: 'ready_check_complete',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
  }

  public async expire(
    matchId: string,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { players: true },
      });
      if (
        match === null ||
        match.state !== 'READY_CHECK' ||
        match.version !== expectedVersion ||
        match.phaseDeadlineAt === null ||
        match.phaseDeadlineAt > new Date()
      )
        return;
      const ready = match.players.filter((player) => player.readyState === 'READY');
      if (ready.length === match.players.length) return;
      await transaction.match.update({
        where: { id: matchId },
        data: {
          state: 'CANCELED',
          cleanupStatus: 'PENDING',
          guildSlotActive: true,
          phaseDeadlineAt: null,
          phaseGeneration: { increment: 1 },
          version: { increment: 1 },
          finishedAt: new Date(),
        },
      });
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: 'READY_CHECK',
          toState: 'CANCELED',
          source: 'READY_CHECK_TIMEOUT',
        },
      });
      if (ready.length > 0) {
        await transaction.tenManQueueEntry.createMany({
          data: ready.map((player) => ({
            guildId: match.guildId,
            discordUserId: player.discordUserId,
            steamId64: player.steamId64,
            displayNameSnapshot: player.displayNameSnapshot,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.tenManQueue.upsert({
        where: { guildId: match.guildId },
        update: { status: 'LOCKED', version: { increment: 1 } },
        create: { guildId: match.guildId, status: 'LOCKED' },
      });
      await transaction.job.upsert({
        where: { idempotencyKey: `cleanup:${matchId}` },
        update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
        create: {
          matchId,
          type: 'CLEANUP_MATCH',
          idempotencyKey: `cleanup:${matchId}`,
          payload: { matchId },
        },
      });
      await dashboardRefresh(transaction, matchId);
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          eventType: 'ready_check_timeout',
          result: 'success',
          correlationId,
          metadata: { returnedReadyPlayers: ready.length },
        },
      });
    });
  }
}

function pickRandomMap(allowlist: readonly string[]): string {
  if (allowlist.length === 0)
    throw new PublicError('NO_MAPS', 'The game profile has no allowed maps.');
  const map = allowlist[randomInt(allowlist.length)];
  if (map === undefined) throw new Error('Random map selection failed');
  return map;
}

async function dashboardRefresh(
  transaction: Parameters<PrismaClient['$transaction']>[0] extends (arg: infer T) => unknown
    ? T
    : never,
  matchId: string,
): Promise<void> {
  await transaction.job.upsert({
    where: { idempotencyKey: `match-dashboard:${matchId}` },
    update: { status: 'PENDING', runAt: new Date(), attempts: 0, lastError: null },
    create: {
      matchId,
      type: 'MATCH_DASHBOARD_REFRESH',
      idempotencyKey: `match-dashboard:${matchId}`,
      payload: { matchId },
    },
  });
}
