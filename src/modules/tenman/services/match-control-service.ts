import type { Logger } from 'pino';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { DatHostClient } from '../integrations/dathost/client.js';
import { type MatchZyAction, renderMatchZyCommand } from '../integrations/matchzy/commands.js';

type MatchZyControlAction = Exclude<MatchZyAction, { type: 'LOAD_MATCH' }>;

export class MatchControlService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly dathost: DatHostClient,
    private readonly logger: Logger,
  ) {}

  public async forceStart(
    matchId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.sendCommand(matchId, { type: 'FORCE_START' }, actorDiscordUserId, correlationId);
  }

  public async pause(
    matchId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.sendCommand(matchId, { type: 'FORCE_PAUSE' }, actorDiscordUserId, correlationId);
  }

  public async resume(
    matchId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.sendCommand(matchId, { type: 'FORCE_UNPAUSE' }, actorDiscordUserId, correlationId);
  }

  public async restoreRound(
    matchId: string,
    round: number,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.sendCommand(
      matchId,
      { type: 'RESTORE_ROUND', round },
      actorDiscordUserId,
      correlationId,
    );
  }

  public async forceEnd(
    matchId: string,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    await this.sendCommand(matchId, { type: 'FORCE_END' }, actorDiscordUserId, correlationId);
  }

  private async sendCommand(
    matchId: string,
    action: MatchZyControlAction,
    actorDiscordUserId: string,
    correlationId: string,
  ): Promise<void> {
    const command = renderMatchZyCommand(action);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, guildId: true, state: true, dathostServerId: true },
    });
    if (match === null) throw new Error('Match not found');
    if (match.dathostServerId === null) throw new Error('Server is not provisioned');

    this.logger.info(
      { matchId, command, actor: actorDiscordUserId },
      'Sending MatchZy control command',
    );
    await this.dathost.sendConsole(match.dathostServerId, command);

    await this.prisma.auditEvent.create({
      data: {
        matchId,
        guildId: match.guildId,
        actorDiscordUserId,
        eventType: 'match_control_executed',
        result: 'success',
        correlationId,
        metadata: { command },
      },
    });
  }
}
