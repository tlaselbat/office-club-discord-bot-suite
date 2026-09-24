import { randomInt } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PublicError } from '../../../errors/public-error.js';
import { schedulePhaseTimeout } from './phase-timeout-job.js';
import { scheduleJob } from '../../../database/schedule-job.js';
import { assertSupportedFormationPolicy } from './formation-policy.js';

const draftOrder = [
  'TEAM_1',
  'TEAM_2',
  'TEAM_2',
  'TEAM_1',
  'TEAM_1',
  'TEAM_2',
  'TEAM_2',
  'TEAM_1',
] as const;

export class DraftService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async pick(
    matchId: string,
    captainDiscordUserId: string,
    selectedDiscordUserId: string,
    expectedVersion: number,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 0))`;
      const match = await transaction.match.findUnique({
        where: { id: matchId },
        include: {
          players: true,
          draftPicks: true,
          guild: {
            select: {
              readyTimeoutSeconds: true,
              captainPolicy: true,
              teamSelectionMode: true,
              mapSelectionMode: true,
            },
          },
          profile: { select: { mapAllowlist: true } },
        },
      });
      if (match === null || match.state !== 'TEAM_SELECTION')
        throw new PublicError('DRAFT_UNAVAILABLE', 'Drafting is no longer active.');
      if (match.version !== expectedVersion)
        throw new PublicError('STALE_COMPONENT', 'This control is stale.');
      assertSupportedFormationPolicy(match.guild);
      if (match.guild.teamSelectionMode !== 'CAPTAINS') {
        throw new PublicError(
          'DRAFT_UNAVAILABLE',
          'This match uses random teams, not a captain draft.',
        );
      }
      if (match.phaseDeadlineAt === null || match.phaseDeadlineAt <= new Date())
        throw new PublicError('STALE_COMPONENT', 'Drafting has expired.');
      const pickNumber = match.draftPicks.length + 1;
      const team = draftOrder[pickNumber - 1];
      if (team === undefined)
        throw new PublicError('DRAFT_COMPLETE', 'The draft is already complete.');
      const captain = match.players.find((player) => player.discordUserId === captainDiscordUserId);
      const selected = match.players.find(
        (player) => player.discordUserId === selectedDiscordUserId,
      );
      if (captain?.captainTeam !== team)
        throw new PublicError('NOT_DRAFT_TURN', 'It is not your draft turn.');
      if (selected === undefined || selected.team !== 'UNASSIGNED')
        throw new PublicError('PLAYER_UNAVAILABLE', 'That player is unavailable.');
      await transaction.matchDraftPick.create({
        data: { matchId, pickNumber, captainDiscordUserId, selectedDiscordUserId, team },
      });
      await transaction.matchPlayer.update({
        where: { matchId_discordUserId: { matchId, discordUserId: selectedDiscordUserId } },
        data: { team, draftOrder: pickNumber },
      });
      const isComplete = pickNumber === draftOrder.length;
      const randomMap = isComplete && match.guild.mapSelectionMode === 'RANDOM';
      const deadline =
        isComplete && !randomMap
          ? new Date(Date.now() + match.guild.readyTimeoutSeconds * 1000)
          : match.phaseDeadlineAt;
      const selectedMap = randomMap ? pickRandomMap(match.profile.mapAllowlist) : null;
      const nextState = isComplete ? (randomMap ? 'TEAMS_LOCKED' : 'MAP_VETO') : 'TEAM_SELECTION';
      const updated = await transaction.match.updateMany({
        where: { id: matchId, version: expectedVersion, state: 'TEAM_SELECTION' },
        data: {
          state: nextState,
          selectedMap,
          phaseDeadlineAt: isComplete && randomMap ? null : deadline,
          version: { increment: 1 },
          ...(isComplete ? { phaseGeneration: { increment: 1 } } : {}),
        },
      });
      if (updated.count !== 1) throw new PublicError('STALE_COMPONENT', 'This control is stale.');
      if (nextState !== 'TEAMS_LOCKED')
        await schedulePhaseTimeout(
          transaction,
          matchId,
          nextState,
          expectedVersion + 1,
          deadline,
          correlationId,
        );
      await scheduleJob(transaction, {
        type: 'MATCH_DASHBOARD_REFRESH',
        idempotencyKey: `match-dashboard:${matchId}`,
        matchId,
        payload: { matchId },
      });
      if (isComplete)
        await transaction.matchStateTransition.create({
          data: {
            matchId,
            fromState: 'TEAM_SELECTION',
            toState: nextState,
            source: randomMap ? 'DRAFT_COMPLETE_RANDOM_MAP' : 'DRAFT_COMPLETE',
          },
        });
      await transaction.auditEvent.create({
        data: {
          matchId,
          guildId: match.guildId,
          actorDiscordUserId: captainDiscordUserId,
          eventType: 'draft_pick',
          result: 'success',
          correlationId,
          metadata: { pickNumber, selectedDiscordUserId, team },
        },
      });
      if (isComplete && randomMap) {
        await scheduleJob(transaction, {
          type: 'PROVISION_SERVER',
          idempotencyKey: `provision:${matchId}`,
          matchId,
          payload: { matchId },
        });
      }
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
