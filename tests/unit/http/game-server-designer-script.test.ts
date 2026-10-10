import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cardLineScript } from '../../../src/http/admin/views/card-lines.js';
import { panelScript } from '../../../src/http/admin/views/client.js';
import { CARD_PLACEHOLDERS } from '../../../src/modules/game-servers/card-profile.js';

describe('Game Servers designer browser script', () => {
  it('compiles the nested Updates editor and its live preview as valid JavaScript', () => {
    expect(() => new Script(cardLineScript)).not.toThrow();
    expect(() => new Script(panelScript)).not.toThrow();
  });

  it('offers every supported placeholder in both layout text dropdowns', () => {
    expect(cardLineScript).toContain(`const placeholders = ${JSON.stringify(CARD_PLACEHOLDERS)};`);
    expect(cardLineScript.match(/placeholders\.map\(/g)).toHaveLength(2);
    expect(cardLineScript).toContain('data-update-placeholder>');
    expect(cardLineScript).toContain('data-layout-placeholder>');
    expect(cardLineScript).toContain('control.setRangeText(insertion,start,end');
  });

  it('exposes normal defaults, timestamp modes, spoiler formatting and clear formatting controls', () => {
    expect(cardLineScript).toContain("style:'normal',timestampMode:'plain'");
    expect(cardLineScript).toContain('value="plain">Plain relative time');
    expect(cardLineScript).toContain('value="discord_native">Discord native relative timestamp');
    expect(cardLineScript).toContain("['Spoiler','||']");
    expect(cardLineScript).toContain('Clear formatting');
    expect(panelScript).toContain('applyTemplateFormatting');
    expect(panelScript).toContain('data-markdown-clear');
  });
});
