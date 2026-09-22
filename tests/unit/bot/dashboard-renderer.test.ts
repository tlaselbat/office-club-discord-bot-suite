import { describe, expect, it } from 'vitest';
import { renderMatchDashboard } from '../../../src/modules/tenman/bot/dashboard-renderer.js';
import { parseMatchCustomId } from '../../../src/modules/tenman/bot/match-custom-id.js';

const secret = 'dashboard-test-secret';
const common = {
  matchId: '123e4567-e89b-12d3-a456-426614174000',
  version: 4,
  phaseGeneration: 2,
  phaseDeadlineAt: null,
  readyDiscordUserIds: [],
  selectedMap: null,
  teamSelectionMode: 'CAPTAINS',
  captainPolicy: 'RANDOM',
  mapSelectionMode: 'CAPTAIN_VETO',
  score: null,
  players: [
    {
      discordUserId: '123456789012345678',
      displayName: 'Alpha',
      team: 'TEAM_1' as const,
      captainTeam: 'TEAM_1' as const,
    },
    {
      discordUserId: '223456789012345678',
      displayName: 'Bravo',
      team: 'TEAM_2' as const,
      captainTeam: 'TEAM_2' as const,
    },
    {
      discordUserId: '323456789012345678',
      displayName: 'Charlie',
      team: 'UNASSIGNED' as const,
      captainTeam: null,
    },
  ],
};

describe('match dashboard', () => {
  it('binds the active captain to a draft picker', () => {
    const result = renderMatchDashboard(
      { ...common, state: 'TEAM_SELECTION', draftPickCount: 0, vetoedMaps: [], allowedMaps: [] },
      secret,
    );
    const customId = (result.components[0] as { components: { custom_id: string }[] }).components[0]
      ?.custom_id;
    expect(customId).toBeDefined();
    expect(parseMatchCustomId(customId ?? '', secret)).toMatchObject({
      action: 'DRAFT_PICK',
      targetDiscordUserId: '123456789012345678',
      version: 4,
      phaseGeneration: 2,
    });
  });

  it('binds the alternating veto turn to its captain', () => {
    const result = renderMatchDashboard(
      {
        ...common,
        state: 'MAP_VETO',
        draftPickCount: 8,
        vetoedMaps: ['de_dust2'],
        allowedMaps: ['de_dust2', 'de_mirage', 'de_inferno'],
      },
      secret,
    );
    const customId = (result.components[0] as { components: { custom_id: string }[] }).components[0]
      ?.custom_id;
    expect(parseMatchCustomId(customId ?? '', secret)).toMatchObject({
      action: 'VETO_BAN',
      targetDiscordUserId: '223456789012345678',
    });
  });

  it('uses Discord identity rather than duplicate display names for ready status', () => {
    const alpha = common.players[0];
    const bravo = common.players[1];
    if (alpha === undefined || bravo === undefined) throw new Error('Missing player fixtures');
    const result = renderMatchDashboard(
      {
        ...common,
        state: 'READY_CHECK',
        draftPickCount: 0,
        vetoedMaps: [],
        allowedMaps: [],
        readyDiscordUserIds: ['123456789012345678'],
        players: [
          {
            ...alpha,
            displayName: 'Same name',
            team: 'UNASSIGNED',
            captainTeam: null,
          },
          {
            ...bravo,
            displayName: 'Same name',
            team: 'UNASSIGNED',
            captainTeam: null,
          },
        ],
      },
      secret,
    );
    const embed = result.embeds[0] as { fields: { value: string }[] };
    expect(embed.fields[0]?.value).toContain('✅ Same name\n❌ Same name');
  });

  it('does not issue controls for an unsupported persisted policy', () => {
    const result = renderMatchDashboard(
      {
        ...common,
        state: 'TEAM_SELECTION',
        teamSelectionMode: 'BALANCED',
        draftPickCount: 0,
        vetoedMaps: [],
        allowedMaps: [],
      },
      secret,
    );
    expect(result.components).toEqual([]);
    expect((result.embeds[0] as { description: string }).description).toContain('unsupported');
  });

  it('shows the score and a signed private-info control only after the server is ready', () => {
    const result = renderMatchDashboard(
      {
        ...common,
        state: 'LIVE',
        draftPickCount: 0,
        vetoedMaps: [],
        allowedMaps: [],
        score: { team1: 10, team2: 8 },
      },
      secret,
    );
    const embed = result.embeds[0] as { fields: { name: string; value: string }[] };
    expect(embed.fields).toContainEqual({
      name: 'Score',
      value: 'Team 1 10 — 8 Team 2',
      inline: true,
    });
    const customId = (result.components[0] as { components: { custom_id: string }[] }).components[0]
      ?.custom_id;
    expect(parseMatchCustomId(customId ?? '', secret)).toMatchObject({ action: 'MY_MATCH_INFO' });
  });

  it('groups finalized rosters and bounds a Discord field with long display names', () => {
    const result = renderMatchDashboard(
      {
        ...common,
        state: 'LIVE',
        draftPickCount: 0,
        vetoedMaps: [],
        allowedMaps: [],
        players: Array.from({ length: 10 }, (_, index) => ({
          discordUserId: String(index + 1).padStart(18, '1'),
          displayName: 'x'.repeat(200),
          team: index < 5 ? ('TEAM_1' as const) : ('TEAM_2' as const),
          captainTeam: null,
        })),
      },
      secret,
    );
    const embed = result.embeds[0] as { fields: { name: string; value: string }[] };
    const players = embed.fields.find((field) => field.name === 'Players');
    expect(players?.value).toContain('**Team 1**');
    expect(players?.value.length).toBeLessThanOrEqual(1024);
  });
});
