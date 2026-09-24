import { describe, expect, it } from 'vitest';
import { isSteamId64, parseSteamIdentifier } from '../../src/modules/tenman/domain/steam-id.js';

describe('Steam identifier parser', () => {
  it('accepts a valid SteamID64', () => {
    expect(parseSteamIdentifier(' 76561197960265728 ')).toEqual({
      type: 'STEAM_ID_64',
      steamId64: '76561197960265728',
    });
  });

  it('rejects malformed SteamID64 values', () => {
    expect(parseSteamIdentifier('123')).toBeNull();
    expect(parseSteamIdentifier('765611999999999999')).toBeNull();
  });

  it('parses a Steam2 identifier', () => {
    expect(parseSteamIdentifier('STEAM_0:1:12345')).toEqual({
      type: 'STEAM_2',
      steamId64: '76561197960290419',
    });
  });

  it('parses a Steam3 identifier', () => {
    expect(parseSteamIdentifier('[U:1:24690]')).toEqual({
      type: 'STEAM_3',
      steamId64: '76561197960290418',
    });
  });

  it('parses profile and vanity URLs', () => {
    expect(parseSteamIdentifier('https://steamcommunity.com/profiles/76561198012345678')).toEqual({
      type: 'PROFILE_URL',
      steamId64: '76561198012345678',
    });
    expect(parseSteamIdentifier('https://steamcommunity.com/id/example/')).toEqual({
      type: 'VANITY_URL',
      steamId64: 'example',
    });
  });
});

describe('isSteamId64', () => {
  it('accepts a valid individual account ID', () => {
    expect(isSteamId64('76561197960265728')).toBe(true);
  });

  it('rejects malformed and out-of-range IDs', () => {
    expect(isSteamId64('123')).toBe(false);
    expect(isSteamId64('765611999999999999')).toBe(false);
  });
});
