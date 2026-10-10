import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cardLineScript } from '../../../src/http/admin/views/card-lines.js';

describe('Game Servers designer browser script', () => {
  it('compiles the nested Updates editor and its live preview as valid JavaScript', () => {
    expect(() => new Script(cardLineScript)).not.toThrow();
  });
});
