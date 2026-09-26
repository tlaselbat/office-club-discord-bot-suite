import { describe, expect, it } from 'vitest';
import { ComponentType } from 'discord.js';
import {
  createAdminQueueConfigCustomId,
  parseAdminQueueConfigCustomId,
} from '../../../src/modules/tenman/bot/admin-queue-config-custom-id.js';
import {
  buildAdminQueueConfiguration,
  configurationDraftFromSettings,
} from '../../../src/modules/tenman/bot/admin-queue-config-components.js';

const payload = {
  guildId: '123456789012345678',
  actorDiscordUserId: '234567890123456789',
  settingsVersion: 4,
  team: 'C' as const,
  map: 'V' as const,
  location: 'D' as const,
};

describe('admin queue configuration controls', () => {
  it('signs an actor-bound configuration selection', () => {
    const id = createAdminQueueConfigCustomId({ ...payload, action: 'SAVE' }, 'secret');
    expect(parseAdminQueueConfigCustomId(id, 'secret')).toEqual({ ...payload, action: 'SAVE' });
    expect(() => parseAdminQueueConfigCustomId(id, 'other-secret')).toThrow('signature');
  });

  it('renders the supported profile and all required choices', () => {
    const response = buildAdminQueueConfiguration(payload, 'secret');
    const embed = response.embeds[0]?.toJSON();
    expect(embed?.fields?.map((field) => field.value)).toContain('Competitive — BO1 5v5 (10 players, 11 slots)');
    expect(response.components).toHaveLength(4);
    const json = response.components.map((row) => row.toJSON());
    const locationMenu = json[2]?.components[0];
    if (locationMenu?.type !== ComponentType.StringSelect) throw new Error('Expected a string select menu');
    expect(locationMenu.options.map((option) => option.label)).toEqual([
      'Central — Dallas',
      'West — Los Angeles',
      'East — Virginia',
    ]);
  });

  it('maps stored settings to supported UI defaults', () => {
    expect(
      configurationDraftFromSettings({
        version: 6,
        teamSelectionMode: 'RANDOM',
        mapSelectionMode: 'RANDOM',
        defaultServerLocation: 'virginia',
      }),
    ).toEqual({ settingsVersion: 6, team: 'S', map: 'R', location: 'V' });
  });
});
