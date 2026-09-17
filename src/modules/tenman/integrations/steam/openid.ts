import { isSteamId64 } from '../../domain/steam-id.js';

const namespace = 'http://specs.openid.net/auth/2.0';
const identifierSelect = `${namespace}/identifier_select`;
const providerUrl = 'https://steamcommunity.com/openid/login';
const claimedIdPattern = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;

export interface SteamOpenIdOptions {
  realm: string;
  returnUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class SteamOpenId {
  private readonly realm: URL;
  private readonly returnUrl: URL;
  private readonly request: typeof fetch;
  private readonly now: () => Date;

  public constructor(options: SteamOpenIdOptions) {
    this.realm = new URL(options.realm);
    this.returnUrl = new URL(options.returnUrl);
    if (this.realm.protocol !== 'https:' || this.returnUrl.protocol !== 'https:')
      throw new Error('Steam OpenID requires HTTPS');
    if (this.realm.origin !== this.returnUrl.origin)
      throw new Error('Realm and return URL origins must match');
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  public createAuthenticationUrl(): URL {
    const url = new URL(providerUrl);
    url.search = new URLSearchParams({
      'openid.ns': namespace,
      'openid.mode': 'checkid_setup',
      'openid.return_to': this.returnUrl.toString(),
      'openid.realm': this.realm.toString(),
      'openid.claimed_id': identifierSelect,
      'openid.identity': identifierSelect,
    }).toString();
    return url;
  }

  public async verify(parameters: URLSearchParams): Promise<string> {
    const value = (name: string): string => {
      const result = parameters.get(name);
      if (result === null) throw new Error(`Missing OpenID field: ${name}`);
      return result;
    };
    if (value('openid.ns') !== namespace || value('openid.mode') !== 'id_res')
      throw new Error('Invalid OpenID response mode');
    if (value('openid.op_endpoint') !== providerUrl) throw new Error('Invalid OpenID provider');
    if (value('openid.return_to') !== this.returnUrl.toString())
      throw new Error('Invalid OpenID return URL');
    const claimedId = value('openid.claimed_id');
    if (value('openid.identity') !== claimedId) throw new Error('OpenID identity mismatch');
    const signedFields = new Set(value('openid.signed').split(','));
    for (const required of [
      'op_endpoint',
      'claimed_id',
      'identity',
      'return_to',
      'response_nonce',
    ]) {
      if (!signedFields.has(required))
        throw new Error(`Unsigned critical OpenID field: ${required}`);
    }
    value('openid.assoc_handle');
    value('openid.sig');
    const nonce = value('openid.response_nonce');
    const nonceTimestamp = nonce.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/u)?.[1];
    const nonceTime = nonceTimestamp === undefined ? Number.NaN : Date.parse(nonceTimestamp);
    const nonceAge = this.now().getTime() - nonceTime;
    if (!Number.isFinite(nonceAge) || nonceAge < -60_000 || nonceAge > 5 * 60_000) {
      throw new Error('Stale OpenID response nonce');
    }
    const match = claimedId.match(claimedIdPattern);
    const steamId64 = match?.[1];
    if (steamId64 === undefined || !isSteamId64(steamId64))
      throw new Error('Invalid Steam claimed identity');

    const verification = new URLSearchParams(parameters);
    verification.set('openid.mode', 'check_authentication');
    const response = await this.request(providerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: verification,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !(await response.text()).split(/\r?\n/u).includes('is_valid:true')) {
      throw new Error('Steam rejected the OpenID assertion');
    }
    return steamId64;
  }
}
