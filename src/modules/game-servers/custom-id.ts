import { createHmac, timingSafeEqual } from 'node:crypto';

export type GameServerAction =
  | 'select'
  | 'add'
  | 'connect'
  | 'map-rules'
  | 'discover'
  | 'page'
  | 'confirm'
  | 'cancel';

export interface GameServerCustomId {
  action: GameServerAction;
  value?: string;
  name?: string;
  ownerId?: string;
}

export function createGameServerCustomId(payload: GameServerCustomId, secret: string): string {
  const value = payload.value === undefined ? '' : Buffer.from(payload.value).toString('base64url');
  const name = payload.name === undefined ? '' : Buffer.from(payload.name).toString('base64url');
  const bound = payload.ownerId === undefined ? '0' : '1';
  const body = `${payload.action}:${value}:${name}:${bound}:${payload.ownerId ?? ''}`;
  const id = `gs:${payload.action}:${value}:${name}:${bound}:${sign(body, secret)}`;
  if (id.length > 100) throw new Error('Game Server component ID is too long');
  return id;
}

export function parseGameServerCustomId(
  customId: string,
  secret: string,
  actorId?: string,
): GameServerCustomId {
  const [namespace, action, encodedValue, encodedName, bound, signature, extra] =
    customId.split(':');
  if (
    namespace !== 'gs' ||
    action === undefined ||
    encodedValue === undefined ||
    encodedName === undefined ||
    (bound !== '0' && bound !== '1') ||
    signature === undefined ||
    extra !== undefined
  )
    throw new Error('Invalid Game Server component ID');
  if (bound === '1' && actorId === undefined)
    throw new Error('Recipient-bound component requires an actor');
  const owner = bound === '1' ? (actorId ?? '') : '';
  const body = `${action}:${encodedValue}:${encodedName}:${bound}:${owner}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new Error('Invalid Game Server component signature');
  if (
    !['select', 'add', 'connect', 'map-rules', 'discover', 'page', 'confirm', 'cancel'].includes(
      action,
    )
  )
    throw new Error('Invalid Game Server component action');
  return {
    action: action as GameServerAction,
    ...(encodedValue === '' ? {} : { value: Buffer.from(encodedValue, 'base64url').toString() }),
    ...(encodedName === '' ? {} : { name: Buffer.from(encodedName, 'base64url').toString() }),
  };
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('game-servers\0')
    .update(body)
    .digest('base64url')
    .slice(0, 12);
}
