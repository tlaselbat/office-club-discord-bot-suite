import type { PrismaClient } from '../../../generated/prisma/client.js';

export type PlayerStatus =
  | { kind: 'NEW_PLAYER' }
  | { kind: 'READY_TO_QUEUE'; queueSize: number; playersInQueue: number }
  | { kind: 'QUEUED'; position: number; playersInQueue: number; queueSize: number }
  | { kind: 'READY_CHECK'; matchId: string; deadlineAt: Date; ready: boolean }
  | { kind: 'MATCH_ACTIVE'; matchId: string; state: string; selectedMap: string | null }
  | { kind: 'TERMINAL'; matchId: string; state: string };

export class PlayerStatusService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async getStatus(guildId: string, discordUserId: string): Promise<PlayerStatus> {
    const [steamIdentity, queueEntry, activeMatch] = await Promise.all([
      this.prisma.steamIdentity.findFirst({
        where: { discordUserId, invalidatedAt: null },
        select: { steamId64: true },
      }),
      this.prisma.tenManQueueEntry.findUnique({
        where: { guildId_discordUserId: { guildId, discordUserId } },
      }),
      this.prisma.match.findFirst({
        where: { guildId, guildSlotActive: true, players: { some: { discordUserId } } },
        select: { id: true, state: true, phaseDeadlineAt: true, selectedMap: true },
      }),
    ]);

    if (activeMatch !== null) {
      if (activeMatch.state === 'READY_CHECK') {
        return {
          kind: 'READY_CHECK',
          matchId: activeMatch.id,
          deadlineAt: activeMatch.phaseDeadlineAt ?? new Date(),
          ready: false,
        };
      }
      if (['FINISHED', 'CANCELED', 'FAILED'].includes(activeMatch.state)) {
        return { kind: 'TERMINAL', matchId: activeMatch.id, state: activeMatch.state };
      }
      return {
        kind: 'MATCH_ACTIVE',
        matchId: activeMatch.id,
        state: activeMatch.state,
        selectedMap: activeMatch.selectedMap,
      };
    }

    const queue = await this.prisma.tenManQueue.findUnique({
      where: { guildId },
      include: { entries: { orderBy: { joinedAt: 'asc' } } },
    });
    const settings = await this.prisma.tenManSettings.findUnique({
      where: { guildId },
      select: { queueSize: true },
    });
    const queueSize = settings?.queueSize ?? 10;
    const playersInQueue = queue?.entries.length ?? 0;

    if (queueEntry !== null) {
      const position =
        (queue?.entries.findIndex((entry) => entry.discordUserId === discordUserId) ?? 0) + 1;
      return { kind: 'QUEUED', position, playersInQueue, queueSize };
    }

    if (steamIdentity === null) {
      return { kind: 'NEW_PLAYER' };
    }

    return { kind: 'READY_TO_QUEUE', queueSize, playersInQueue };
  }
}
