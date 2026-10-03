import { describe, expect, it } from 'vitest';
import { parseAdminPanelCustomId } from '../../../src/modules/tenman/bot/admin-panel-custom-id.js';
import {
  renderAdminPanel,
  type AdminPanelView,
} from '../../../src/modules/tenman/bot/admin-panel-renderer.js';

const secret = 'admin-panel-test-secret';
const view: AdminPanelView = {
  guildId: '123456789012345678',
  settingsVersion: 4,
  queueVersion: 2,
  enabled: true,
  queueStatus: 'OPEN',
  queueCount: 3,
  queueCapacity: 10,
  profile: 'competitive_5v5',
  location: 'dallas',
  matchModeratorCount: 1,
};

describe('admin panel renderer', () => {
  it('renders map management as an internal persistent panel view', () => {
    const response = renderAdminPanel(view, secret, {
      kind: 'MAPS',
      maps: {
        guildId: view.guildId,
        settingsVersion: view.settingsVersion,
        activePool: { source: 'PROFILE_DEFAULT', mapNames: ['de_mirage', 'de_inferno'] },
        officialMaps: ['de_mirage', 'de_inferno'],
        workshopMaps: [],
        page: 0,
      },
    });

    expect(response.embeds[0]?.toJSON()).toMatchObject({
      title: 'Map Source and Pool',
      fields: [expect.objectContaining({ value: '0 configured maps' })],
    });
    expect(response.components).toHaveLength(4);
    expect(response.components[1]?.toJSON().components[0]).toMatchObject({ disabled: true });
    const back = response.components[3]?.toJSON().components[0] as {
      label?: string;
      custom_id?: string;
    };
    expect(back.label).toBe('Back to Match Queue Control');
    expect(parseAdminPanelCustomId(back.custom_id ?? '', secret)).toMatchObject({
      action: 'MAIN',
      guildId: view.guildId,
    });
  });

  it('keeps the main queue operations available after returning', () => {
    const response = renderAdminPanel(view, secret);
    expect(response.embeds[0]?.toJSON().title).toBe('Match Queue Control');
    expect(response.components).toHaveLength(2);
  });
});
