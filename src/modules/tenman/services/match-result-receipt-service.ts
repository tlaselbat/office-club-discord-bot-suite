import { EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

const TERMINAL_STATES = new Set(['FINISHED', 'CANCELED', 'FAILED']);

type MatchResult = {
  team1SeriesScore: number;
  team2SeriesScore: number;
  winner: { team: string };
};

export class MatchResultReceiptService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: Client,
  ) {}

  /**
   * Posts or edits the durable result receipt for a match.
   * Idempotent: an existing MATCH_RESULT_RECEIPT resource is edited rather than duplicated.
   */
  public async postReceipt(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: { include: { user: { select: { displayName: true } } } },
        ratingChanges: true,
        demoReferences: true,
        guild: { select: { resultsChannelId: true } },
      },
    });

    if (
      match === null ||
      !TERMINAL_STATES.has(match.state) ||
      match.guild.resultsChannelId === null
    )
      return;

    const channel = await this.discord.channels
      .fetch(match.guild.resultsChannelId)
      .catch(() => null);
    if (channel === null || !channel.isTextBased()) return;

    const existingResource = await this.prisma.matchDiscordResource.findFirst({
      where: { matchId, resourceType: 'MATCH_RESULT_RECEIPT' },
    });

    const payload = {
      embeds: [this.buildEmbed({ ...match, result: match.result as MatchResult | null })],
    };

    const textChannel = channel as TextChannel;
    if (existingResource?.discordId !== null && existingResource?.discordId !== undefined) {
      try {
        await textChannel.messages.edit(existingResource.discordId, payload);
        return;
      } catch {
        // Message was deleted or channel changed; post a new one below.
      }
    }

    const message = await textChannel.send(payload);
    await this.prisma.matchDiscordResource.upsert({
      where: {
        id: existingResource?.id ?? '00000000-0000-0000-0000-000000000000',
      },
      update: {
        discordId: message.id,
        state: 'ACTIVE',
      },
      create: {
        matchId,
        resourceType: 'MATCH_RESULT_RECEIPT',
        discordId: message.id,
        state: 'ACTIVE',
        createdByBot: true,
      },
    });
  }

  private buildEmbed(match: {
    state: string;
    result: { team1SeriesScore: number; team2SeriesScore: number; winner: { team: string } } | null;
    selectedMap: string | null;
    players: Array<{
      discordUserId: string;
      steamId64: string;
      team: string;
      user: { displayName: string };
    }>;
    ratingChanges: Array<{ discordUserId: string; delta: number; ratingAfter: number }>;
    demoReferences: Array<{ status: string }>;
  }): EmbedBuilder {
    const embed = new EmbedBuilder().setTitle('Competitive Match Result').setTimestamp();

    if (match.state === 'CANCELED') {
      embed.setDescription('This match was canceled.').setColor(0x808080);
    } else if (match.state === 'FAILED') {
      embed
        .setDescription('This match failed before a result could be recorded.')
        .setColor(0x808080);
    } else if (match.result === null) {
      embed.setDescription('Final result is not available.').setColor(0x808080);
    } else {
      const winnerName = match.result.winner.team === 'team2' ? 'Team 2' : 'Team 1';
      const scoreLine = `**${String(match.result.team1SeriesScore)} - ${String(match.result.team2SeriesScore)}**`;
      embed
        .setDescription(`${winnerName} wins ${scoreLine}`)
        .setColor(winnerName === 'Team 1' ? 0x3498db : 0xe74c3c);

      if (match.selectedMap !== null) {
        embed.addFields({ name: 'Map', value: match.selectedMap, inline: true });
      }

      const ratingByUser = new Map(
        match.ratingChanges.map((change) => [change.discordUserId, change]),
      );

      for (const team of ['TEAM_1', 'TEAM_2'] as const) {
        const teamName = team === 'TEAM_1' ? 'Team 1' : 'Team 2';
        const teamPlayers = match.players.filter((player) => player.team === team);
        const lines = teamPlayers.map((player) => {
          const change = ratingByUser.get(player.discordUserId);
          const delta = change?.delta ?? 0;
          const sign = delta > 0 ? '+' : '';
          return `${player.user.displayName} — ${sign}${String(delta)} points (${String(change?.ratingAfter ?? 1000)})`;
        });
        embed.addFields({
          name: teamName,
          value: lines.join('\n') || 'No players',
          inline: true,
        });
      }
    }

    const artifactStatus =
      match.demoReferences.length === 0
        ? 'Demo unavailable'
        : match.demoReferences.map((demo) => demo.status).join(', ');
    embed.addFields({ name: 'Demo status', value: artifactStatus, inline: false });

    return embed;
  }
}
