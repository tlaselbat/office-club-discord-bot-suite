import { assertAuthorized, type ActorContext } from '../domain/authorization.js';
import { RandomTeamBalancer } from '../domain/teams.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';

export interface CreateMatchCommand {
  guildId: string;
  leaderDiscordUserId: string;
  displayName: string;
  correlationId: string;
}

export interface JoinMatchCommand {
  matchId: string;
  discordUserId: string;
  displayName: string;
  correlationId: string;
}

export class MatchService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(command: CreateMatchCommand): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.guildId}, 0))`;
      const active = await transaction.match.findFirst({
        where: { guildId: command.guildId, guildSlotActive: true },
        select: { id: true },
      });
      if (active !== null) {
        throw new PublicError('ACTIVE_MATCH_EXISTS', 'This server already has an active 10man.');
      }
      const settings = await transaction.tenManSettings.findUnique({
        where: { guildId: command.guildId },
      });
      if (settings === null || !settings.enabled || settings.defaultGameProfileKey === null) {
        throw new Error('Guild 10man configuration is incomplete');
      }
      await transaction.user.upsert({
        where: { discordUserId: command.leaderDiscordUserId },
        update: { displayName: command.displayName },
        create: { discordUserId: command.leaderDiscordUserId, displayName: command.displayName },
      });
      const match = await transaction.match.create({
        data: {
          guildId: command.guildId,
          leaderDiscordUserId: command.leaderDiscordUserId,
          selectedGameProfileKey: settings.defaultGameProfileKey,
          state: 'OPEN',
        },
      });
      await transaction.matchStateTransition.create({
        data: {
          matchId: match.id,
          fromState: 'CREATED',
          toState: 'OPEN',
          source: 'DISCORD_CREATE',
        },
      });
      await transaction.auditEvent.create({
        data: {
          matchId: match.id,
          guildId: command.guildId,
          actorDiscordUserId: command.leaderDiscordUserId,
          eventType: 'match_created',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {},
        },
      });
      return match.id;
    });
  }

  public async failUnpublishedMatch(matchId: string, correlationId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || match.dathostServerId !== null) return;
      await transaction.match.update({
        where: { id: matchId },
        data: {
          state: 'FAILED',
          guildSlotActive: false,
          failureReason: 'Initial Discord panel could not be published',
          finishedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await transaction.matchStateTransition.create({
        data: {
          matchId,
          fromState: match.state,
          toState: 'FAILED',
          source: 'PANEL_PUBLISH_FAILED',
        },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          eventType: 'panel_publish_failed',
          result: 'failed',
          correlationId,
          metadata: {},
        },
      });
    });
  }

  public async join(command: JoinMatchCommand): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: command.matchId },
        include: { profile: true, players: true },
      });
      if (match === null || match.state !== 'OPEN') throw new Error('Match is not open');
      const identity = await transaction.steamIdentity.findFirst({
        where: { discordUserId: command.discordUserId, invalidatedAt: null },
      });
      if (identity === null) throw new Error('A verified Steam account is required');
      const capacity = match.profile.playersPerTeam * 2;
      if (match.players.length >= capacity) throw new Error('Match is full');
      await transaction.user.upsert({
        where: { discordUserId: command.discordUserId },
        update: { displayName: command.displayName },
        create: { discordUserId: command.discordUserId, displayName: command.displayName },
      });
      await transaction.matchPlayer.create({
        data: {
          matchId: match.id,
          discordUserId: command.discordUserId,
          steamId64: identity.steamId64,
          displayNameSnapshot: command.displayName,
        },
      });
      if (match.players.length + 1 === capacity) {
        const updated = await transaction.match.updateMany({
          where: { id: match.id, state: 'OPEN', version: match.version },
          data: { state: 'FULL', version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error('Match changed concurrently');
        await transaction.matchStateTransition.create({
          data: { matchId: match.id, fromState: 'OPEN', toState: 'FULL', source: 'PLAYER_JOIN' },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId: match.id,
          guildId: match.guildId,
          actorDiscordUserId: command.discordUserId,
          eventType: 'player_joined',
          result: 'success',
          correlationId: command.correlationId,
          metadata: {},
        },
      });
    });
  }

  public async leave(matchId: string, actor: ActorContext, correlationId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || !['OPEN', 'FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Players cannot leave in the current state');
      }
      assertAuthorized('LEAVE', actor, match);
      const removed = await transaction.matchPlayer.deleteMany({
        where: { matchId, discordUserId: actor.discordUserId },
      });
      if (removed.count !== 1) throw new Error('Player is not in this match');
      if (match.state !== 'OPEN') {
        await transaction.match.update({
          where: { id: matchId },
          data: { state: 'OPEN', version: { increment: 1 } },
        });
        await transaction.matchStateTransition.create({
          data: { matchId, fromState: match.state, toState: 'OPEN', source: 'PLAYER_LEAVE' },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'player_left',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
  }

  public async assignTeam(
    matchId: string,
    targetDiscordUserId: string,
    team: 'TEAM_1' | 'TEAM_2',
    actor: ActorContext,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || !['FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Teams cannot be changed in the current state');
      }
      assertAuthorized('ORGANIZE_TEAMS', actor, match);
      if (match.version !== expectedVersion) throw new Error('Match panel is stale');
      const updatedPlayer = await transaction.matchPlayer.updateMany({
        where: { matchId, discordUserId: targetDiscordUserId },
        data: { team },
      });
      if (updatedPlayer.count !== 1) throw new Error('Player is not in this match');
      await transaction.match.update({
        where: { id: matchId },
        data: { state: 'TEAM_SETUP', version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'teams_changed',
          result: 'success',
          correlationId,
          metadata: { targetDiscordUserId, team },
        },
      });
    });
  }

  public async randomizeTeams(
    matchId: string,
    actor: ActorContext,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { players: true, profile: true },
      });
      if (match === null || !['FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Teams cannot be randomized in the current state');
      }
      assertAuthorized('ORGANIZE_TEAMS', actor, match);
      if (match.version !== expectedVersion) throw new Error('Match panel is stale');
      const capacity = match.profile.playersPerTeam * 2;
      if (match.players.length !== capacity) throw new Error('The lobby is not full');
      const assignment = new RandomTeamBalancer().generate(match.players);
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
      await transaction.match.update({
        where: { id: matchId },
        data: { state: 'TEAM_SETUP', version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'teams_changed',
          result: 'success',
          correlationId,
          metadata: { method: 'random' },
        },
      });
    });
  }

  public async selectMap(
    matchId: string,
    mapName: string,
    actor: ActorContext,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { profile: true },
      });
      if (match === null || !['FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Map cannot be selected in the current state');
      }
      assertAuthorized('SELECT_MAP', actor, match);
      if (match.version !== expectedVersion) throw new Error('Match panel is stale');
      if (!match.profile.mapAllowlist.includes(mapName)) throw new Error('Map is not allowed');
      const updated = await transaction.match.updateMany({
        where: { id: matchId, version: expectedVersion },
        data: { selectedMap: mapName, state: 'TEAM_SETUP', version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('Match changed concurrently');
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'map_selected',
          result: 'success',
          correlationId,
          metadata: { mapName },
        },
      });
    });
  }

  public async lockTeams(
    matchId: string,
    actor: ActorContext,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { players: true, profile: true },
      });
      if (match === null || match.state !== 'TEAM_SETUP')
        throw new Error('Teams are not ready to lock');
      assertAuthorized('LOCK_TEAMS', actor, match);
      if (match.version !== expectedVersion) throw new Error('Match panel is stale');
      if (match.selectedMap === null) throw new Error('A map must be selected');
      const team1 = match.players.filter((player) => player.team === 'TEAM_1');
      const team2 = match.players.filter((player) => player.team === 'TEAM_2');
      if (
        team1.length !== match.profile.playersPerTeam ||
        team2.length !== match.profile.playersPerTeam
      ) {
        throw new Error('Teams do not match the profile size');
      }
      const updated = await transaction.match.updateMany({
        where: { id: matchId, version: expectedVersion, state: 'TEAM_SETUP' },
        data: { state: 'TEAMS_LOCKED', version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('Match changed concurrently');
      await transaction.matchStateTransition.create({
        data: { matchId, fromState: 'TEAM_SETUP', toState: 'TEAMS_LOCKED', source: 'DISCORD_LOCK' },
      });
      await transaction.job.create({
        data: {
          matchId,
          type: 'PROVISION_SERVER',
          idempotencyKey: `provision:${matchId}`,
          payload: { matchId },
        },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'teams_locked',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
  }

  public async cancel(matchId: string, actor: ActorContext, correlationId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null || ['FINISHED', 'CANCELED', 'FAILED'].includes(match.state)) {
        throw new Error('Match is already terminal');
      }
      assertAuthorized('STOP', actor, match);
      const requiresCleanup = match.dathostServerId !== null;
      await transaction.match.update({
        where: { id: matchId },
        data: {
          state: 'CANCELED',
          cleanupStatus: requiresCleanup ? 'PENDING' : 'NOT_REQUIRED',
          guildSlotActive: requiresCleanup,
          finishedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await transaction.matchStateTransition.create({
        data: { matchId, fromState: match.state, toState: 'CANCELED', source: 'DISCORD_CANCEL' },
      });
      if (requiresCleanup) {
        await transaction.job.create({
          data: {
            matchId,
            type: 'CLEANUP_MATCH',
            idempotencyKey: `cleanup:${matchId}`,
            payload: { matchId },
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'match_canceled',
          result: 'success',
          correlationId,
          metadata: { requiresCleanup },
        },
      });
    });
  }

  public async transferLeader(
    matchId: string,
    newLeaderDiscordUserId: string,
    actor: ActorContext,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { players: true },
      });
      if (match === null) throw new Error('Match not found');
      if (['FINISHED', 'CANCELED', 'FAILED'].includes(match.state)) {
        throw new Error('Match is already terminal');
      }
      assertAuthorized('TRANSFER_LEADER', actor, match);
      const participant = match.players.find(
        (player) => player.discordUserId === newLeaderDiscordUserId,
      );
      if (participant === undefined) throw new Error('Target is not a participant');
      await transaction.match.update({
        where: { id: matchId },
        data: { leaderDiscordUserId: newLeaderDiscordUserId, version: { increment: 1 } },
      });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'leader_transferred',
          result: 'success',
          correlationId,
          metadata: { newLeaderDiscordUserId },
        },
      });
    });
  }

  public async setReady(
    matchId: string,
    actor: ActorContext,
    ready: boolean,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null) throw new Error('Match not found');
      if (!['OPEN', 'FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Ready state cannot be changed in the current state');
      }
      assertAuthorized('READY', actor, match);
      const updated = await transaction.matchPlayer.updateMany({
        where: { matchId, discordUserId: actor.discordUserId },
        data: { readyState: ready ? 'READY' : 'NOT_READY' },
      });
      if (updated.count !== 1) throw new Error('Player is not in this match');
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: ready ? 'player_ready' : 'player_unready',
          result: 'success',
          correlationId,
          metadata: {},
        },
      });
    });
  }

  public async removeParticipant(
    matchId: string,
    targetDiscordUserId: string,
    actor: ActorContext,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({ where: { id: matchId } });
      if (match === null) throw new Error('Match not found');
      if (!['OPEN', 'FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Participants cannot be removed in the current state');
      }
      assertAuthorized('REMOVE_PARTICIPANT', actor, match);
      const removed = await transaction.matchPlayer.deleteMany({
        where: { matchId, discordUserId: targetDiscordUserId },
      });
      if (removed.count !== 1) throw new Error('Target is not a participant');
      if (match.state !== 'OPEN') {
        await transaction.match.update({
          where: { id: matchId },
          data: { state: 'OPEN', version: { increment: 1 } },
        });
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: match.state,
            toState: 'OPEN',
            source: 'MODERATOR_REMOVE',
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'participant_removed',
          result: 'success',
          correlationId,
          metadata: { targetDiscordUserId },
        },
      });
    });
  }

  public async selectProfile(
    matchId: string,
    profileKey: string,
    actor: ActorContext,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: { players: true },
      });
      if (match === null || !['OPEN', 'FULL', 'TEAM_SETUP'].includes(match.state)) {
        throw new Error('Profile cannot be changed in the current state');
      }
      assertAuthorized('SELECT_PROFILE', actor, match);
      if (match.version !== expectedVersion) throw new Error('Match panel is stale');
      const profile = await transaction.gameProfile.findUnique({ where: { key: profileKey } });
      if (profile === null || !profile.enabled) {
        throw new PublicError('PROFILE_UNAVAILABLE', 'That game profile is not available.');
      }
      const capacity = profile.playersPerTeam * 2;
      if (match.players.length > capacity) {
        throw new PublicError(
          'PROFILE_CAPACITY',
          `That profile supports ${String(capacity)} players, but ${String(match.players.length)} are already in the lobby.`,
        );
      }
      const state = match.players.length === capacity ? 'FULL' : 'OPEN';
      const selectedMap = profile.mapAllowlist.includes(match.selectedMap ?? '')
        ? match.selectedMap
        : null;
      await transaction.matchPlayer.updateMany({
        where: { matchId },
        data: { team: 'UNASSIGNED' },
      });
      const updated = await transaction.match.updateMany({
        where: { id: matchId, version: expectedVersion },
        data: {
          selectedGameProfileKey: profileKey,
          selectedMap,
          state,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('Match changed concurrently');
      if (match.state !== state) {
        await transaction.matchStateTransition.create({
          data: { matchId, fromState: match.state, toState: state, source: 'PROFILE_SELECTED' },
        });
      }
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: actor.discordUserId,
          eventType: 'profile_selected',
          result: 'success',
          correlationId,
          metadata: { profileKey },
        },
      });
    });
  }

  public findGuildMatch(guildId: string) {
    return this.prisma.match.findFirst({
      where: { guildId, guildSlotActive: true },
      include: { players: { orderBy: { joinedAt: 'asc' } }, profile: true },
    });
  }
}
