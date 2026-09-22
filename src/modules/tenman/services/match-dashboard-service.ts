import { randomUUID } from 'node:crypto';
import type { Client, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { renderMatchDashboard } from '../bot/dashboard-renderer.js';
import { isReconcilable, MATCH_RESOURCE_CREATION_LEASE_MS } from './match-resource-service.js';

/** Persists dashboard-message creation with the same conservative lease policy as channels. */
export class MatchDashboardService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly secret: string,
  ) {}

  public async refresh(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: true,
        discordResources: true,
        draftPicks: true,
        vetoActions: true,
        profile: true,
        guild: { select: { teamSelectionMode: true, captainPolicy: true, mapSelectionMode: true } },
      },
    });
    if (match === null || !isReconcilable(match)) return;
    const channelResource = match.discordResources.find(
      (resource) =>
        resource.resourceType === 'MATCH_TEXT_CHANNEL' &&
        resource.state === 'ACTIVE' &&
        resource.discordId !== null,
    );
    const channelId = channelResource?.discordId;
    if (channelId === null || channelId === undefined) return;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (channel === null || !channel.isTextBased()) return;
    const dashboard = await this.prisma.matchDiscordResource.upsert({
      where: { matchId_resourceType: { matchId, resourceType: 'MATCH_DASHBOARD_MESSAGE' } },
      update: {},
      create: { matchId, resourceType: 'MATCH_DASHBOARD_MESSAGE', state: 'PENDING_CREATE' },
    });
    const payload = renderMatchDashboard(
      {
        matchId,
        state: match.state,
        version: match.version,
        phaseGeneration: match.phaseGeneration,
        phaseDeadlineAt: match.phaseDeadlineAt,
        readyDiscordUserIds: match.players
          .filter((player) => player.readyState === 'READY')
          .map((player) => player.discordUserId),
        players: match.players.map((player) => ({
          discordUserId: player.discordUserId,
          displayName: player.displayNameSnapshot,
          team: player.team,
          captainTeam: player.captainTeam,
        })),
        selectedMap: match.selectedMap,
        draftPickCount: match.draftPicks.length,
        vetoedMaps: match.vetoActions.map((action) => action.mapName),
        allowedMaps: match.profile.mapAllowlist,
        teamSelectionMode: match.guild.teamSelectionMode,
        captainPolicy: match.guild.captainPolicy,
        mapSelectionMode: match.guild.mapSelectionMode,
        score: parseScore(match.score),
      },
      this.secret,
    );
    const text = channel as TextChannel;
    if (dashboard.state === 'ACTIVE' && dashboard.discordId !== null) {
      const message = await text.messages.fetch(dashboard.discordId).catch(() => null);
      if (message !== null) {
        await message.edit(payload);
        return;
      }
      await this.prisma.matchDiscordResource.updateMany({
        where: { id: dashboard.id, state: 'ACTIVE', discordId: dashboard.discordId },
        data: {
          discordId: null,
          createdByBot: false,
          state: 'PENDING_CREATE',
          creationAttemptId: null,
          creationLeaseExpiresAt: null,
          creationIoStartedAt: null,
        },
      });
      return this.refresh(matchId);
    }
    if (dashboard.state === 'CREATE_IN_FLIGHT') {
      if (await this.reclaimStalePreIoClaim(dashboard.id)) return this.refresh(matchId);
      throw new Error('Match dashboard creation is ambiguous and requires recovery');
    }
    if (dashboard.state !== 'PENDING_CREATE') return;

    const attemptId = await this.claimCreation(dashboard.id);
    if (attemptId === null) return this.refresh(matchId);
    // Revalidate before the send. Terminal cleanup can mark the resource while
    // a refresh job is queued; no Discord message is sent in that case.
    const current = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { state: true, cleanupStatus: true },
    });
    if (current === null || !isReconcilable(current)) {
      await this.resetPending(dashboard.id, attemptId);
      return;
    }
    if (!(await this.markCreationIoStarted(dashboard.id, attemptId))) return;
    const message = await text.send(payload);
    const afterSend = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { state: true, cleanupStatus: true },
    });
    const activated =
      afterSend !== null &&
      isReconcilable(afterSend) &&
      (
        await this.prisma.matchDiscordResource.updateMany({
          where: {
            id: dashboard.id,
            state: 'CREATE_IN_FLIGHT',
            creationAttemptId: attemptId,
          },
          data: {
            discordId: message.id,
            createdByBot: true,
            state: 'ACTIVE',
            creationLeaseExpiresAt: null,
          },
        })
      ).count === 1;
    if (activated) return;

    // The message is now proven bot-created. Persist ownership before trying
    // deletion so a crash remains recoverable by normal cleanup.
    await this.prisma.matchDiscordResource.update({
      where: { id: dashboard.id },
      data: {
        discordId: message.id,
        createdByBot: true,
        state: 'PENDING_DELETE',
        creationLeaseExpiresAt: null,
      },
    });
    await message.delete();
    await this.prisma.matchDiscordResource.update({
      where: { id: dashboard.id },
      data: { state: 'DELETED', deletedAt: new Date() },
    });
  }

  private async claimCreation(resourceId: string): Promise<string | null> {
    const attemptId = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.matchDiscordResource.updateMany({
      where: { id: resourceId, state: 'PENDING_CREATE' },
      data: {
        state: 'CREATE_IN_FLIGHT',
        creationAttemptId: attemptId,
        creationLeaseExpiresAt: new Date(now.getTime() + MATCH_RESOURCE_CREATION_LEASE_MS),
        creationIoStartedAt: null,
      },
    });
    return claimed.count === 1 ? attemptId : null;
  }

  private async reclaimStalePreIoClaim(resourceId: string): Promise<boolean> {
    const reclaimed = await this.prisma.matchDiscordResource.updateMany({
      where: {
        id: resourceId,
        state: 'CREATE_IN_FLIGHT',
        creationIoStartedAt: null,
        creationLeaseExpiresAt: { lt: new Date() },
      },
      data: {
        state: 'PENDING_CREATE',
        creationAttemptId: null,
        creationLeaseExpiresAt: null,
      },
    });
    return reclaimed.count === 1;
  }

  private async markCreationIoStarted(resourceId: string, attemptId: string): Promise<boolean> {
    const started = await this.prisma.matchDiscordResource.updateMany({
      where: {
        id: resourceId,
        state: 'CREATE_IN_FLIGHT',
        creationAttemptId: attemptId,
        creationIoStartedAt: null,
        creationLeaseExpiresAt: { gt: new Date() },
      },
      data: { creationIoStartedAt: new Date() },
    });
    return started.count === 1;
  }

  private async resetPending(resourceId: string, attemptId: string): Promise<void> {
    await this.prisma.matchDiscordResource.updateMany({
      where: {
        id: resourceId,
        state: 'CREATE_IN_FLIGHT',
        creationAttemptId: attemptId,
        creationIoStartedAt: null,
      },
      data: {
        state: 'PENDING_CREATE',
        creationAttemptId: null,
        creationLeaseExpiresAt: null,
      },
    });
  }
}

function parseScore(score: unknown): { team1: number; team2: number } | null {
  if (typeof score !== 'object' || score === null || Array.isArray(score)) return null;
  const candidate = score as { team1?: unknown; team2?: unknown };
  return typeof candidate.team1 === 'number' && typeof candidate.team2 === 'number'
    ? { team1: candidate.team1, team2: candidate.team2 }
    : null;
}
