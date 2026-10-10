import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cardLineScript } from '../../../src/http/admin/views/card-lines.js';
import { panelScript } from '../../../src/http/admin/views/client.js';
import { cardPreviewScript } from '../../../src/http/admin/views/card-preview.js';
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

  it('prevents partial editors and previews when layout initialization fails', () => {
    expect(cardLineScript).toContain(
      "if(layoutJson.dataset.layoutValid!=='true')throw new Error('Invalid layout')",
    );
    expect(cardLineScript).toContain('const staging=document.createElement');
    expect(cardLineScript).toContain('layoutJson.dataset.savedLayoutInvalid');
    expect(cardLineScript).toContain("control.value='1';control.checked=value===true");
    expect(cardLineScript).toContain('layoutProperties.textContent=savedInvalid?');
    expect(cardLineScript).toContain('Discard changes to reload the saved configuration.');
  });

  it('fixes the legacy toolbar selection dispatch and button style preview classes', () => {
    expect(panelScript).toContain('const start = control.selectionStart;');
    expect(panelScript).toContain(
      'const selected = control.value.slice(control.selectionStart, control.selectionEnd);',
    );
    expect(panelScript).toContain("control.dispatchEvent(new Event('input', { bubbles: true }))");
    expect(cardPreviewScript).toContain("preview-button-'+(button.style");
    expect(cardPreviewScript).toContain("layoutJson?.dataset?.layoutValid === 'false'");
  });

  it('uses one button label for Unicode or leading custom emoji and mutually exclusive text accessories', () => {
    expect(cardLineScript).not.toContain('data-button-field="emoji"');
    expect(cardLineScript).toContain("button.emoji+' '");
    expect(cardLineScript).toContain('data-thread-accessory');
    expect(cardLineScript).toContain('syncTextAccessory(node)');
    expect(cardLineScript).toContain("if(destination!=='none'&&!buttonAccessory?.value)");
    expect(cardLineScript).toContain('Enabled everywhere');
    expect(cardLineScript).toContain(
      "row.querySelector('[data-button-style-setting]').hidden=isLink",
    );
    expect(cardPreviewScript).toContain("const customEmoji=String(button.label||'').match");
  });

  it('supports selectable preview blocks, relative insertion and draft undo/redo', () => {
    expect(cardLineScript).toContain(
      "previewRoot?.addEventListener('click',handlePreviewSelection)",
    );
    expect(cardLineScript).toContain("event.key!=='Enter'&&event.key!==' '");
    expect(cardLineScript).toContain('const insertRelativeToSelection=(type,side)=>');
    expect(cardLineScript).toContain('const historyLimit=50');
    expect(cardLineScript).toContain('const updatePlaceholderSuggestions=(control)=>');
    expect(cardLineScript).toContain("control.setAttribute('aria-autocomplete','list')");
    expect(cardLineScript).toContain("list?.querySelector('[data-placeholder-choice]')?.focus()");
    expect(cardLineScript).toContain('runHistory(undoHistory,redoHistory)');
    expect(cardLineScript).toContain('runHistory(redoHistory,undoHistory)');
    expect(cardPreviewScript).toContain(
      "node.setAttribute('aria-pressed',String(node.dataset.previewElement===selectedLayoutId))",
    );
    expect(cardPreviewScript).toContain('span.dataset.previewButtonId=button.id');
    expect(cardPreviewScript).toContain('display.dataset.previewNestedBlock=block.id');
    expect(cardPreviewScript).toContain('gallery.dataset.previewNestedBlock=block.id');
    expect(cardLineScript).toContain('const nestedId=element.dataset.previewNestedBlock');
    expect(cardLineScript).toContain('nestedBlock.scrollIntoView({block:');
    expect(cardLineScript).toContain('directChildren>10');
    expect(cardLineScript).toContain('10 direct Container children');
    expect(cardLineScript).toContain(
      'Copy Address replies privately with the server address for the user to copy.',
    );
  });
});
