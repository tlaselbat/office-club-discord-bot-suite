import { describe, expect, it, vi } from 'vitest';
import { SteamOpenId } from '../../src/modules/tenman/integrations/steam/openid.js';

const returnUrl = 'https://bot.example.com/auth/steam/callback';

function validResponse(): URLSearchParams {
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.return_to': returnUrl,
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561197960265728',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561197960265728',
    'openid.response_nonce': '2026-01-01T00:00:00Zrandom',
    'openid.assoc_handle': 'handle',
    'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'signature',
  });
}

describe('Steam OpenID', () => {
  it('builds a provider URL from fixed server configuration', () => {
    const steam = new SteamOpenId({ realm: 'https://bot.example.com/', returnUrl });
    expect(steam.createAuthenticationUrl().origin).toBe('https://steamcommunity.com');
  });

  it('accepts only assertions Steam verifies server-side', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('ns:x\nis_valid:true\n'));
    const steam = new SteamOpenId({
      realm: 'https://bot.example.com/',
      returnUrl,
      fetch: request,
      now: () => new Date('2026-01-01T00:01:00Z'),
    });
    await expect(steam.verify(validResponse())).resolves.toBe('76561197960265728');
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects stale response nonces before contacting Steam', async () => {
    const request = vi.fn<typeof fetch>();
    const steam = new SteamOpenId({
      realm: 'https://bot.example.com/',
      returnUrl,
      fetch: request,
      now: () => new Date('2026-01-01T00:10:00Z'),
    });
    await expect(steam.verify(validResponse())).rejects.toThrow('Stale OpenID response nonce');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects altered return URLs before contacting Steam', async () => {
    const request = vi.fn<typeof fetch>();
    const response = validResponse();
    response.set('openid.return_to', 'https://attacker.example/');
    const steam = new SteamOpenId({
      realm: 'https://bot.example.com/',
      returnUrl,
      fetch: request,
      now: () => new Date('2026-01-01T00:01:00Z'),
    });
    await expect(steam.verify(response)).rejects.toThrow('Invalid OpenID return URL');
    expect(request).not.toHaveBeenCalled();
  });
});
