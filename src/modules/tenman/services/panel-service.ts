import type { APIEmbed, Client, TextBasedChannel, TextChannel } from 'discord.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { buildMatchControls } from '../bot/components.js';
import { renderMatchPanel, type RenderedPanel } from '../bot/panel.js';
import { parseMatchScore } from '../domain/score.js';

interface MatchForPanel {
  id: string;
  leaderDiscordUserId: string;
  state: string;
  cleanupStatus: string;
  selectedMap: string | null;
  selectedGameProfileKey: string;
  version: number;
  discordPanelChannelId: string | null;
  discordPanelMessageId: string | null;
  players: { team: string; readyState: string; displayNameSnapshot: string }[];
  profile: { mapAllowlist: string[] };
  score: unknown;
}

export class PanelService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Client,
    private readonly componentSigningSecret: string,
  ) {}

  public async publishInitialPanel(
    matchId: string,
    channel: TextBasedChannel,
  ): Promise<{ channelId: string; messageId: string }> {
    const match = await this.findMatch(matchId);
    const { embeds, components } = await this.render(match);
    const message = await (channel as unknown as TextChannel).send({ embeds, components });
    await this.prisma.match.update({
      where: { id: matchId },
      data: { discordPanelChannelId: channel.id, discordPanelMessageId: message.id },
    });
    return { channelId: channel.id, messageId: message.id };
  }

  public async refresh(matchId: string): Promise<void> {
    const match = await this.findMatch(matchId);
    if (match.discordPanelChannelId === null || match.discordPanelMessageId === null) return;
    const channel = (await this.client.channels
      .fetch(match.discordPanelChannelId)
      .catch(() => null)) as TextChannel | null;
    if (channel === null) return;
    const { embeds, components } = await this.render(match);
    const message = await channel.messages.fetch(match.discordPanelMessageId).catch(() => null);
    if (message === null) {
      const sent = await channel.send({ embeds, components });
      await this.prisma.match.update({
        where: { id: matchId },
        data: { discordPanelMessageId: sent.id },
      });
      return;
    }
    await message.edit({ embeds, components });
  }

  public async clear(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { discordPanelChannelId: true, discordPanelMessageId: true },
    });
    if (
      match === null ||
      match.discordPanelChannelId === null ||
      match.discordPanelMessageId === null
    )
      return;
    const channel = (await this.client.channels
      .fetch(match.discordPanelChannelId)
      .catch(() => null)) as TextChannel | null;
    if (channel === null) return;
    const message = await channel.messages.fetch(match.discordPanelMessageId).catch(() => null);
    if (message !== null) {
      await message.edit({ components: [] }).catch(() => undefined);
    }
  }

  private async findMatch(matchId: string): Promise<MatchForPanel> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { players: true, profile: true },
    });
    if (match === null) throw new Error('Match not found');
    return match as MatchForPanel;
  }

  private async render(match: MatchForPanel) {
    const profiles = await this.prisma.gameProfile.findMany({
      where: { enabled: true },
      orderBy: { key: 'asc' },
      select: { key: true },
    });
    const allowedProfiles = profiles.map((profile) => ({ key: profile.key, label: profile.key }));
    const panel = renderMatchPanel({
      matchId: match.id,
      leaderMention: `<@${match.leaderDiscordUserId}>`,
      state: match.state as Parameters<typeof renderMatchPanel>[0]['state'],
      cleanupStatus: match.cleanupStatus as Parameters<typeof renderMatchPanel>[0]['cleanupStatus'],
      map: match.selectedMap,
      profile: match.selectedGameProfileKey,
      readyCount: match.players.filter((player) => player.readyState === 'READY').length,
      totalCount: match.players.length,
      team1: match.players
        .filter((player) => player.team === 'TEAM_1')
        .map((player) => player.displayNameSnapshot),
      team2: match.players
        .filter((player) => player.team === 'TEAM_2')
        .map((player) => player.displayNameSnapshot),
      score: parseMatchScore(match.score),
    });
    const controls = buildMatchControls({
      matchId: match.id,
      version: match.version,
      state: match.state as Parameters<typeof buildMatchControls>[0]['state'],
      allowedMaps: match.profile.mapAllowlist,
      allowedProfiles,
      secret: this.componentSigningSecret,
    });
    return { embeds: [toApiEmbed(panel)], components: controls };
  }
}

function toApiEmbed(panel: RenderedPanel): APIEmbed {
  return {
    title: panel.title,
    description: panel.description,
    fields: panel.fields.map((field) => ({
      name: field.name,
      value: field.value,
      ...(field.inline === undefined ? {} : { inline: field.inline }),
    })),
  };
}
