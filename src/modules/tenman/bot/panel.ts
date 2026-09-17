import type { CleanupStatus, MatchState } from '../domain/match-state.js';

export interface MatchPanelView {
  matchId: string;
  leaderMention: string;
  state: MatchState;
  cleanupStatus: CleanupStatus;
  map: string | null;
  profile: string;
  readyCount: number;
  totalCount: number;
  team1: readonly string[];
  team2: readonly string[];
  score: { team1: number; team2: number } | null;
}

export interface RenderedPanel {
  title: string;
  description: string;
  fields: { name: string; value: string; inline?: boolean }[];
}

export function renderMatchPanel(view: MatchPanelView): RenderedPanel {
  const cleanupBlocksCreation = ['PENDING', 'RUNNING', 'RETRY', 'FAILED'].includes(
    view.cleanupStatus,
  );
  return {
    title: `10Man ${view.matchId.slice(0, 8)}`,
    description: cleanupBlocksCreation
      ? `Match outcome: **${view.state}**\nCleanup: **${view.cleanupStatus}** — a new 10man is blocked until cleanup completes.`
      : `Match state: **${view.state}**\nCleanup: **${view.cleanupStatus}**`,
    fields: [
      { name: 'Leader', value: view.leaderMention, inline: true },
      { name: 'Map', value: view.map ?? 'Not selected', inline: true },
      { name: 'Profile', value: view.profile, inline: true },
      {
        name: 'Ready',
        value: `${String(view.readyCount)}/${String(view.totalCount)}`,
        inline: true,
      },
      { name: 'Team 1', value: view.team1.join('\n') || 'Unassigned' },
      { name: 'Team 2', value: view.team2.join('\n') || 'Unassigned' },
      {
        name: 'Score',
        value:
          view.score === null
            ? 'Not live'
            : `${String(view.score.team1)}–${String(view.score.team2)}`,
        inline: true,
      },
    ],
  };
}
