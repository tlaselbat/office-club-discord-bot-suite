import { describe, expect, it } from 'vitest';
import {
  createGameServerCustomId,
  parseGameServerCustomId,
} from '../../../../src/modules/game-servers/custom-id.js';

describe('Game Server custom IDs', () => {
  it('round-trips public controls', () => {
    const id = createGameServerCustomId({ action: 'add' }, 'secret');
    expect(parseGameServerCustomId(id, 'secret', 'someone')).toEqual({ action: 'add' });
  });

  it('round-trips Copy Address controls', () => {
    const id = createGameServerCustomId({ action: 'copy-address', value: 'server-1' }, 'secret');
    expect(parseGameServerCustomId(id, 'secret', 'someone')).toEqual({
      action: 'copy-address',
      value: 'server-1',
    });
  });

  it('binds administrator mutations to their recipient', () => {
    const id = createGameServerCustomId(
      { action: 'confirm', value: 'server-1', name: 'Arena', ownerId: 'admin-1' },
      'secret',
    );
    expect(parseGameServerCustomId(id, 'secret', 'admin-1')).toMatchObject({
      action: 'confirm',
      value: 'server-1',
      name: 'Arena',
    });
    expect(() => parseGameServerCustomId(id, 'secret', 'admin-2')).toThrow('signature');
  });
});
