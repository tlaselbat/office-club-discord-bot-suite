import { resolveCardTemplate, styleCardLine } from '../../../modules/game-servers/renderer.js';

/** Shared substitutions and heading rules; the browser approximation only adds safe DOM nodes. */
export const cardLineScript = String.raw`
const resolveLineTemplate = ${resolveCardTemplate.toString()};
const styleLineText = ${styleCardLine.toString()};
const lineEditors = document.getElementById('card-line-editors');
const previewRoot = document.getElementById('card-template-preview');
const formControl = (name) => document.querySelector('[name="' + name + '"]');
const inputValue = (name, fallback = '') => formControl(name)?.value ?? fallback;
const lineNodes = () => Array.from(lineEditors?.querySelectorAll('[data-card-line]') ?? []);
const refreshLineSummaries = () => lineNodes().forEach((node) => {
  const summary = node.querySelector('[data-line-summary]');
  const meta = node.querySelector('[data-line-meta]');
  const text = node.querySelector('[data-card-template]')?.value ?? '';
  const style = node.querySelector('[data-line-style]')?.selectedOptions[0]?.textContent ?? 'Normal';
  const visible = node.querySelector('input[type="checkbox"]')?.checked;
  if (summary) summary.textContent = text.trim() || 'Empty line';
  if (meta) meta.textContent = (visible ? 'Visible' : 'Hidden') + ' · ' + style;
});
const syncLineOrder = () => {
  const order = document.getElementById('card-line-order');
  if (order instanceof HTMLInputElement) order.value = lineNodes().map((node) => node.dataset.cardLine).join(',');
  lineNodes().forEach((node, index, nodes) => {
    node.querySelector('[data-move-line="up"]').disabled = index === 0;
    node.querySelector('[data-move-line="down"]').disabled = index === nodes.length - 1;
  });
};
const markCardDirty = () => {
  if (!(cardForm instanceof HTMLFormElement)) return;
  updateDirtyState();
};
const insertLineText = (control, token) => {
  if (!(control instanceof HTMLTextAreaElement)) return;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  if (control.value.length - (end - start) + token.length > control.maxLength) return;
  control.setRangeText(token, start, end, 'end');
  control.focus();
  control.dispatchEvent(new Event('input', { bubbles: true }));
};
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  const node = button.closest('[data-card-line]');
  if (button.dataset.insertLinePlaceholder && node) {
    insertLineText(document.getElementById(button.dataset.insertLinePlaceholder), node.querySelector('[data-line-placeholder]').value);
  }
  if (button.dataset.resetLine && node) {
    node.querySelector('[data-card-template]').value = button.dataset.resetValue ?? '';
    node.querySelector('[data-line-style]').value = button.dataset.resetStyle ?? 'normal';
    node.querySelector('input[type="checkbox"]').checked = true;
    markCardDirty();
    updateCardPreview();
  }
  if (button.dataset.moveLine && node && lineEditors) {
    if (button.dataset.moveLine === 'up' && node.previousElementSibling) lineEditors.insertBefore(node, node.previousElementSibling);
    if (button.dataset.moveLine === 'down' && node.nextElementSibling) lineEditors.insertBefore(node.nextElementSibling, node);
    syncLineOrder();
    markCardDirty();
    updateCardPreview();
    button.focus();
  }
  if (button.hasAttribute('data-reset-card-profile')) {
    let defaults;
    try { defaults = JSON.parse(button.dataset.defaults ?? '{}'); } catch { return; }
    for (const [name, value] of Object.entries(defaults)) {
      const control = formControl(name);
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === true;
      else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) control.value = String(value);
    }
    for (const id of String(defaults.lineOrder ?? '').split(',')) {
      const node = lineNodes().find((item) => item.dataset.cardLine === id);
      if (node) lineEditors.append(node);
    }
    syncLineOrder();
    markCardDirty();
    updateCardPreview();
  }
  if (button.hasAttribute('data-discard-server-changes') && cardForm instanceof HTMLFormElement) {
    if (submitted) {
      cardForm.dataset.dirty = 'false';
      window.location.reload();
      return;
    }
    cardForm.reset();
    for (const id of originalLineOrder) {
      const node = lineNodes().find((item) => item.dataset.cardLine === id);
      if (node) lineEditors.append(node);
    }
    syncLineOrder();
    refreshLineSummaries();
    updateDirtyState();
  }
});
document.addEventListener('toggle', (event) => {
  const opened = event.target;
  if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
  if (!opened.matches('[data-card-line]')) return;
  lineNodes().forEach((node) => { if (node !== opened) node.open = false; });
}, true);
// Parse a conservative Markdown subset into text nodes. Never interpret HTML or create user URLs.
const appendInlineMarkdown = (parent, content) => {
  const pattern = /(\x60[^\x60\n]+\x60|\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|\*[^\n]+?\*)/g;
  let offset = 0;
  for (const match of content.matchAll(pattern)) {
    parent.append(document.createTextNode(content.slice(offset, match.index)));
    const token = match[0];
    const marker = token.startsWith('\x60') ? '\x60' : token.startsWith('***') ? '***' : token.startsWith('**') ? '**' : token.startsWith('__') ? '__' : token.startsWith('~~') ? '~~' : '*';
    const element = document.createElement(marker === '\x60' ? 'code' : marker === '*' ? 'em' : marker === '__' ? 'u' : marker === '~~' ? 's' : 'strong');
    const inner = token.slice(marker.length, -marker.length);
    if (marker === '\x60') element.textContent = inner;
    else if (marker === '***') { const italic = document.createElement('em'); appendInlineMarkdown(italic, inner); element.append(italic); }
    else appendInlineMarkdown(element, inner);
    parent.append(element);
    offset = match.index + token.length;
  }
  parent.append(document.createTextNode(content.slice(offset)));
};
const previewIcon = (state, mode) => {
  const kind = mode === 'current' && state !== 'pending' && state !== 'stale' && previewRoot?.dataset.gameplayState === 'DEGRADED' ? 'warning' : state === 'online' ? 'online' : state === 'offline' || state === 'unavailable' ? 'offline' : state === 'pending' ? 'pending' : 'warning';
  const id = inputValue(kind + 'EmojiId');
  const inherited = previewRoot?.dataset[kind + 'Emoji'] ?? '';
  return /^\d{17,20}$/.test(id) ? '<:' + kind + '_dot:' + id + '>' : inherited || '•';
};
const updateCardPreview = () => {
  if (!(previewRoot instanceof HTMLElement)) return;
  let current;
  try { current = JSON.parse(previewRoot.dataset.currentValues ?? '{}'); } catch { current = {}; }
  const mode = document.getElementById('card-preview-mode')?.value ?? 'current';
  const state = mode !== 'current' ? (mode === 'missing' ? 'unavailable' : mode) : previewRoot.dataset.stale === 'true' ? 'stale' : previewRoot.dataset.hostingState === 'PENDING' ? 'pending' : previewRoot.dataset.hostingState === 'STOPPED' ? 'offline' : previewRoot.dataset.hostingState === 'STARTING' ? 'starting' : previewRoot.dataset.hostingState === 'RUNNING' && previewRoot.dataset.gameplayState === 'AVAILABLE' ? 'online' : 'unavailable';
  const values = { ...current };
  if (mode !== 'current') Object.assign(values, { playercount: '0/5', players: '0', maxplayers: '5', location: 'Dallas', currentmap: 'aim_redline_fp', lastupdated: 'Just now' });
  if (mode === 'missing') Object.assign(values, { playercount: 'Unknown', players: '', maxplayers: '', location: '', currentmap: 'Unknown', lastupdated: '' });
  const label = inputValue(state + 'StatusLabel', current.status ?? 'Unavailable');
  Object.assign(values, { status: label, statusicon: previewIcon(state, mode), online: previewIcon(state, mode) + ' ' + label, servername: inputValue('displayName', current.servername) });
  const host = inputValue('connectDomain') || previewRoot.dataset.rawHost || '';
  values.serverip = host;
  values.serveraddress = host ? host + (values.serverport ? ':' + values.serverport : '') : 'Unavailable';
  values.severaddress = values.serveraddress;
  const output = document.getElementById('card-preview-lines');
  if (!output) return;
  output.replaceChildren();
  lineNodes().forEach((node) => {
    if (!node.querySelector('input[type="checkbox"]').checked) return;
    const text = styleLineText(resolveLineTemplate(node.querySelector('[data-card-template]').value, values), node.querySelector('[data-line-style]').value);
    if (!text.trim()) return;
    const block = document.createElement('div');
    block.dataset.previewLine = node.dataset.cardLine;
    text.split('\n').forEach((line) => {
      const heading = line.match(/^(#{1,3}|-#)\s+(.*)$/);
      const element = document.createElement(heading ? heading[1] === '-#' ? 'small' : 'h' + heading[1].length : 'p');
      appendInlineMarkdown(element, heading ? heading[2] : line);
      block.append(element);
    });
    output.append(block);
  });
  const artwork = document.getElementById('card-preview-artwork');
  const actions = document.getElementById('card-preview-actions');
  if (!artwork || !actions) return;
  artwork.replaceChildren();
  actions.replaceChildren();
  const showArtwork = formControl('showMapArtwork');
  const actionLabels = [
    ['showConnectButton', 'connectButtonLabel', 'Connect'],
    ['showMapRulesButton', 'mapRulesButtonLabel', 'Map & Rules'],
  ];
  const visibleActions = actionLabels.filter(([toggle]) => formControl(toggle)?.checked);
  if (showArtwork?.checked || visibleActions.length > 0) {
    const separator = document.createElement('hr');
    separator.setAttribute('aria-hidden', 'true');
    output.append(separator);
  }
  if (showArtwork?.checked) {
    const artworkSlot = document.createElement('div');
    artworkSlot.className = 'preview-artwork';
    artworkSlot.textContent = 'Map artwork · ' + (values.currentmap || 'image shown when available');
    artwork.append(artworkSlot);
  }
  if (visibleActions.length > 0) {
    const actionRow = document.createElement('div');
    actionRow.className = 'preview-action-row';
    actionRow.setAttribute('aria-label', 'Approximate Discord action row');
    visibleActions.forEach(([, labelName, fallback]) => {
      const button = document.createElement('span');
      button.className = 'preview-action';
      button.textContent = inputValue(labelName, fallback);
      actionRow.append(button);
    });
    actions.append(actionRow);
  }
};
const cardForm = document.querySelector('form[action$="/edit"]');
const dirtyStatus = document.getElementById('card-config-dirty-status');
const originalLineOrder = lineNodes().map((node) => node.dataset.cardLine).filter(Boolean);
if (cardForm instanceof HTMLFormElement) {
  const initial = new URLSearchParams(new FormData(cardForm)).toString();
  const submitted = cardForm.querySelector('[data-submitted-edits]') !== null;
  const updateDirtyState = () => {
    const dirty = submitted || new URLSearchParams(new FormData(cardForm)).toString() !== initial;
    if (dirtyStatus) dirtyStatus.textContent = dirty ? 'Unsaved changes. Save server to apply them.' : 'All changes saved.';
    cardForm.dataset.dirty = dirty ? 'true' : 'false';
    const saveButton = cardForm.querySelector('button[type="submit"]');
    if (saveButton instanceof HTMLButtonElement && saveButton.textContent !== 'Saving…') {
      saveButton.disabled = !dirty;
    }
    refreshLineSummaries();
    updateCardPreview();
  };
  cardForm.addEventListener('input', updateDirtyState);
  cardForm.addEventListener('change', updateDirtyState);
  window.addEventListener('beforeunload', (event) => {
    if (cardForm.dataset.dirty !== 'true' || cardForm.dataset.saving === 'true') return;
    event.preventDefault(); event.returnValue = '';
  });
  cardForm.addEventListener('submit', () => {
    cardForm.dataset.saving = 'true';
    const submit = cardForm.querySelector('button[type="submit"]');
    if (submit instanceof HTMLButtonElement) { submit.disabled = true; submit.textContent = 'Saving…'; }
    if (dirtyStatus) dirtyStatus.textContent = 'Saving changes…';
  });
  updateDirtyState();
}
document.getElementById('card-preview-mode')?.addEventListener('change', updateCardPreview);
syncLineOrder();
updateCardPreview();
`;
