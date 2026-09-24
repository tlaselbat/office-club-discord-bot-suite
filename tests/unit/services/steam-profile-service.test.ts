import { describe, expect, it, vi } from 'vitest';
import { createSteamProfileService } from '../../../src/modules/tenman/services/steam-profile-service.js';

const service = createSteamProfileService('test-key');
const serviceWithoutKey = createSteamProfileService(undefined);

describe('OptionalSteamProfileService', () => {
  it('returns null without an API key', async () => {
    await expect(serviceWithoutKey.resolveVanityUrl('example')).resolves.toBeNull();
    await expect(serviceWithoutKey.getPlayerSummary('76561198000000001')).resolves.toBeNull();
  });

  it('resolves a vanity URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ response: { success: 1, steamid: '76561198000000001' } }),
    });

    await expect(service.resolveVanityUrl('example')).resolves.toBe('76561198000000001');
  });

  it('returns null for an unresolved vanity URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ response: { success: 42, message: 'No match' } }),
    });

    await expect(service.resolveVanityUrl('missing')).resolves.toBeNull();
  });

  it('fetches a player summary', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: {
          players: [
            {
              steamid: '76561198000000001',
              personaname: 'PlayerOne',
              profileurl: 'https://steamcommunity.com/id/playerone/',
            },
          ],
        },
      }),
    });

    await expect(service.getPlayerSummary('76561198000000001')).resolves.toEqual({
      steamId64: '76561198000000001',
      displayName: 'PlayerOne',
      profileUrl: 'https://steamcommunity.com/id/playerone/',
    });
  });

  it('returns null when the Steam API fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    await expect(service.getPlayerSummary('76561198000000001')).resolves.toBeNull();
  });
});
