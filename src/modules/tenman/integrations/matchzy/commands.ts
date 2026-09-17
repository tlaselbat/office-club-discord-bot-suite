export type MatchZyAction =
  | { type: 'LOAD_MATCH'; url: string; headerName: string; headerValue: string }
  | { type: 'FORCE_START' }
  | { type: 'FORCE_PAUSE' }
  | { type: 'FORCE_UNPAUSE' }
  | { type: 'RESTORE_ROUND'; round: number }
  | { type: 'FORCE_END' };

const safeHeaderName = /^[A-Za-z0-9-]{1,64}$/;

function quote(value: string): string {
  if (/[\r\n"\\]/u.test(value)) throw new Error('Unsafe MatchZy command argument');
  return `"${value}"`;
}

export function renderMatchZyCommand(action: MatchZyAction): string {
  switch (action.type) {
    case 'LOAD_MATCH': {
      if (/[\r\n"\\]/u.test(action.url)) throw new Error('Unsafe MatchZy load parameters');
      const url = new URL(action.url);
      if (url.protocol !== 'https:' || !safeHeaderName.test(action.headerName)) {
        throw new Error('Unsafe MatchZy load parameters');
      }
      return `matchzy_loadmatch_url ${quote(url.toString())} ${quote(action.headerName)} ${quote(action.headerValue)}`;
    }
    case 'FORCE_START':
      return 'css_start';
    case 'FORCE_PAUSE':
      return 'css_forcepause';
    case 'FORCE_UNPAUSE':
      return 'css_forceunpause';
    case 'RESTORE_ROUND':
      if (!Number.isInteger(action.round) || action.round < 0 || action.round > 100)
        throw new Error('Invalid restore round');
      return `css_restore ${String(action.round)}`;
    case 'FORCE_END':
      return 'css_forceend';
  }
}
