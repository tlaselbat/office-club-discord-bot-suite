import { describe, expect, it } from 'vitest';
import { buildMapPoolManagement } from '../../../src/modules/tenman/bot/map-pool-components.js';
import {
  createMapPoolCustomId,
  parseMapPoolCustomId,
} from '../../../src/modules/tenman/bot/map-pool-custom-id.js';

const secret = 'map-pool-test-secret';
const basePayload = {
  guildId: '123456789012345678',
  actorDiscordUserId: '234567890123456789',
  settingsVersion: 4,
  page: 0,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
} as const;

describe('map pool components', () => {
  it('signs actor-bound, expiring controls', () => {
    const customId = createMapPoolCustomId({ ...basePayload, action: 'POOL' }, secret);
    expect(parseMapPoolCustomId(customId, secret)).toMatchObject({
      ...basePayload,
      action: 'POOL',
    });
    expect(() => parseMapPoolCustomId(`${customId}x`, secret)).toThrow('signature');
  });

  it("limits map select pages to Discord's 25 options", () => {
    const officialMaps = Array.from({ length: 26 }, (_, index) => `de_map_${String(index)}`);
    const response = buildMapPoolManagement(
      {
        ...basePayload,
        activePool: { mapNames: [], source: 'PROFILE_DEFAULT' },
        officialMaps,
        workshopMaps: [],
      },
      secret,
    );
    const poolSelect = JSON.parse(JSON.stringify(response.components[0]?.toJSON())) as {
      components: Array<{ options?: unknown[] }>;
    };
    expect(poolSelect.components[0]?.options).toHaveLength(25);
    expect(response.components[2]?.toJSON().components[2]?.disabled).toBe(false);
  });

  it('renders a valid disabled pool selector when no maps are available', () => {
    const response = buildMapPoolManagement(
      {
        ...basePayload,
        activePool: { mapNames: [], source: 'PROFILE_DEFAULT' },
        officialMaps: [],
        workshopMaps: [],
      },
      secret,
    );
    const poolSelect = response.components[0]?.toJSON().components[0] as {
      disabled?: boolean;
      max_values?: number;
      options?: Array<{ label: string; value: string }>;
    };
    expect(poolSelect).toMatchObject({ disabled: true, max_values: 1 });
    expect(poolSelect.options).toEqual([
      expect.objectContaining({ label: 'No maps available', value: 'none' }),
    ]);
  });
});
