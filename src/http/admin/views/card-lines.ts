import { resolveCardTemplate, styleCardLine } from '../../../modules/game-servers/renderer.js';

/** Shared substitutions and heading rules; the browser approximation only adds safe DOM nodes. */
export const cardLineScript = String.raw`
const resolveLineTemplate = ${resolveCardTemplate.toString()};
const styleLineText = ${styleCardLine.toString()};
const lineEditors = document.getElementById('card-line-editors');
const layoutEditors = document.getElementById('card-layout-editors');
const layoutJson = document.getElementById('card-layout-json');
let isHydratingLayout = false;
const previewRoot = document.getElementById('card-template-preview');
const formControl = (name) => document.querySelector('[name="' + name + '"]');
const inputValue = (name, fallback = '') => formControl(name)?.value ?? fallback;
let submitted = false;
let updateDirtyState = () => {};
const lineNodes = () => Array.from(lineEditors?.querySelectorAll('[data-card-line]') ?? []);
const layoutNodes = () => Array.from(layoutEditors?.querySelectorAll('[data-layout-element]') ?? []);
const saveLayout = () => {
  if (!(layoutJson instanceof HTMLInputElement)) return;
  layoutJson.value = JSON.stringify(layoutNodes().map((node) => {
    const read = (name) => node.querySelector('[data-layout-field="' + name + '"]');
    const base = { id: node.dataset.layoutId, type: node.dataset.layoutElement, label: read('label')?.value || node.dataset.layoutElement, visible: read('visible')?.checked ?? true };
    if (base.type === 'text') return { ...base, template: read('template')?.value ?? '', style: read('style')?.value ?? 'normal' };
    if (base.type === 'section') return { ...base, template: read('template')?.value ?? '', style: read('style')?.value ?? 'normal', thumbnailUrl: read('thumbnailUrl')?.value || null };
    if (base.type === 'gallery') return { ...base, items: Array.from(node.querySelectorAll('[data-gallery-item]')).map((item) => ({ id: item.dataset.itemId, source: item.querySelector('[data-layout-field="source"]')?.value ?? 'map', url: item.querySelector('[data-layout-field="url"]')?.value || null, description: item.querySelector('[data-layout-field="description"]')?.value ?? '' })) };
    if (base.type === 'separator') return { ...base, divider: read('divider')?.checked ?? true, spacing: Number(read('spacing')?.value ?? 1) };
    return base;
  }));
};
const addLayoutElement = (type, data = {}) => {
  if (!layoutEditors) return;
  const id = crypto.randomUUID();
  const label = data.label ?? ({ text: 'Text line', gallery: 'Image gallery', separator: 'Separator', section: 'Text and thumbnail' }[type] ?? 'Layout element');
  const control = (name, value, extra = '') => '<label>' + name + '<input data-layout-field="' + name + '" value="' + escapeAttr(value) + '" ' + extra + '></label>';
  const common = '<label class="checkbox"><input data-layout-field="visible" type="checkbox" checked> Visible</label>' + control('label', label);
  let settings = common;
  if (type === 'text' || type === 'section') settings += control('template', data.template ?? '{servername}', 'maxlength="500"') + '<label>Text style<select data-layout-field="style">' + ['large','medium','small','normal','subtext'].map((s) => '<option>' + s + '</option>').join('') + '</select></label>';
  if (type === 'section') settings += control('thumbnailUrl', '', 'type="url" placeholder="Use default thumbnail"');
  if (type === 'gallery') settings += '<div data-gallery-items></div><button type="button" data-gallery-add>Add image</button>';
  if (type === 'separator') settings += '<label class="checkbox"><input data-layout-field="divider" type="checkbox" checked> Visible divider</label><label>Spacing<select data-layout-field="spacing"><option value="1">Small</option><option value="2">Large</option></select></label>';
  const node = document.createElement('details');
  node.className = 'card-line-editor'; node.open = true; node.dataset.layoutElement = type; node.dataset.layoutId = id;
  node.innerHTML = '<summary><span class="line-summary-title">' + escapeText(label) + '</span><span class="line-summary-text">' + type + '</span></summary><div class="card-line-content">' + settings + '<div class="actions"><button type="button" data-layout-move="up">Up</button><button type="button" data-layout-move="down">Down</button><button type="button" data-layout-duplicate>Duplicate</button><button type="button" data-layout-remove>Remove</button></div></div>';
  layoutEditors.append(node);
  if (type === 'gallery') addGalleryItem(node, data.items?.[0]);
  if (!isHydratingLayout) { saveLayout(); markCardDirty(); updateCardPreview(); }
};
const escapeText = (value) => { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; };
const escapeAttr = (value) => escapeText(String(value)).replace(/"/g, '&quot;');
const addGalleryItem = (node, data = {}) => {
  const holder = node.querySelector('[data-gallery-items]'); if (!holder || holder.children.length >= 10) return;
  const id = data.id ?? crypto.randomUUID();
  const item = document.createElement('fieldset'); item.dataset.galleryItem = 'true'; item.dataset.itemId = id;
  item.innerHTML = '<legend>Image</legend><label>Image source<select data-layout-field="source"><option value="map">Automatic current map</option><option value="fallback">Default fallback</option><option value="custom">Custom HTTPS URL</option></select></label>' + '<label>Custom HTTPS URL<input data-layout-field="url" type="url" maxlength="500" placeholder="https://..."></label><label>Media description<input data-layout-field="description" maxlength="1024"></label><button type="button" data-gallery-remove>Remove image</button>';
  holder.append(item);
  item.querySelector('[data-layout-field="source"]').value = data.source ?? 'map';
  item.querySelector('[data-layout-field="url"]').value = data.url ?? '';
  item.querySelector('[data-layout-field="description"]').value = data.description ?? '{currentmap} map artwork';
};
const renderLayoutElement = (element) => {
  addLayoutElement(element.type, element);
  const node = layoutNodes().at(-1);
  if (!node) return;
  node.dataset.layoutId = element.id;
  const set = (name, value) => { const control = node.querySelector('[data-layout-field="' + name + '"]'); if (!control) return; if (control.type === 'checkbox') control.checked = Boolean(value); else control.value = value ?? ''; };
  set('label', element.label); set('visible', element.visible);
  if (element.type === 'text' || element.type === 'section') { set('template', element.template); set('style', element.style); }
  if (element.type === 'section') set('thumbnailUrl', element.thumbnailUrl);
  if (element.type === 'gallery') { const holder = node.querySelector('[data-gallery-items]'); holder.replaceChildren(); (element.items ?? []).forEach((item) => addGalleryItem(node, item)); }
  if (element.type === 'separator') { set('divider', element.divider); set('spacing', element.spacing); }
  const title = node.querySelector('.line-summary-title'); if (title) title.textContent = element.label;
};
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
  const layoutNode = button.closest('[data-layout-element]');
  if (button.dataset.addLayout) addLayoutElement(button.dataset.addLayout);
  if (layoutNode && button.dataset.layoutMove) {
    if (button.dataset.layoutMove === 'up' && layoutNode.previousElementSibling) layoutEditors.insertBefore(layoutNode, layoutNode.previousElementSibling);
    if (button.dataset.layoutMove === 'down' && layoutNode.nextElementSibling) layoutEditors.insertBefore(layoutNode.nextElementSibling, layoutNode);
    saveLayout(); markCardDirty(); updateCardPreview();
  }
  if (layoutNode && button.hasAttribute('data-layoutDuplicate')) {
    const read = (name) => layoutNode.querySelector('[data-layout-field="' + name + '"]');
    const type = layoutNode.dataset.layoutElement;
    const data = { label: (read('label')?.value ?? 'Element') + ' copy', visible: true };
    if (type === 'text' || type === 'section') Object.assign(data, { template: read('template')?.value ?? '', style: read('style')?.value ?? 'normal', thumbnailUrl: read('thumbnailUrl')?.value || null });
    if (type === 'gallery') data.items = Array.from(layoutNode.querySelectorAll('[data-gallery-item]')).map((item) => ({ id: crypto.randomUUID(), source: item.querySelector('[data-layout-field="source"]').value, url: item.querySelector('[data-layout-field="url"]').value || null, description: item.querySelector('[data-layout-field="description"]').value }));
    if (type === 'separator') Object.assign(data, { divider: read('divider')?.checked ?? true, spacing: Number(read('spacing')?.value ?? 1) });
    addLayoutElement(type, data);
  }
  if (layoutNode && button.hasAttribute('data-galleryAdd')) { addGalleryItem(layoutNode); saveLayout(); markCardDirty(); updateCardPreview(); }
  if (layoutNode && button.hasAttribute('data-galleryRemove')) { button.closest('[data-gallery-item]')?.remove(); saveLayout(); markCardDirty(); updateCardPreview(); }
  if (layoutNode && button.hasAttribute('data-layoutRemove')) { layoutNode.remove(); saveLayout(); markCardDirty(); updateCardPreview(); }
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
  const activeNodes = layoutNodes();
  (activeNodes.length ? activeNodes : lineNodes()).forEach((node) => {
    if (activeNodes.length) {
      const type = node.dataset.layoutElement;
      const read = (name) => node.querySelector('[data-layout-field="' + name + '"]');
      if (!read('visible')?.checked) return;
      const text = type === 'text' || type === 'section' ? styleLineText(resolveLineTemplate(read('template')?.value ?? '', values), read('style')?.value ?? 'normal') : '';
      if (text.trim()) { const block = document.createElement('div'); appendInlineMarkdown(block, text); output.append(block); }
      if (type === 'gallery') Array.from(node.querySelectorAll('[data-gallery-item]')).forEach((item) => { const gallery = document.createElement('div'); gallery.className = 'preview-artwork'; const source = item.querySelector('[data-layout-field="source"]')?.value; gallery.textContent = source === 'custom' ? item.querySelector('[data-layout-field="url"]')?.value || 'Custom image URL required' : source === 'fallback' ? 'Default fallback artwork' : 'Map artwork · ' + values.currentmap; output.append(gallery); });
      if (type === 'separator') { const separator = document.createElement(read('divider')?.checked ? 'hr' : 'div'); if (!read('divider')?.checked) separator.className = 'preview-separator-space'; output.append(separator); }
      return;
    }
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
const sectionLinks = Array.from(document.querySelectorAll('.game-server-section-nav a[href^="#"]'));
const updateActiveSection = () => {
  sectionLinks.forEach((link) => {
    if (link.getAttribute('href') === window.location.hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
};
window.addEventListener('hashchange', updateActiveSection);
updateActiveSection();
if (cardForm instanceof HTMLFormElement) {
  const initial = new URLSearchParams(new FormData(cardForm)).toString();
  submitted = cardForm.querySelector('[data-submitted-edits]') !== null;
  updateDirtyState = () => {
    if (layoutNodes().length) saveLayout();
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
if (layoutEditors && layoutJson instanceof HTMLInputElement) {
  try {
    const elements = JSON.parse(layoutJson.value);
    if (Array.isArray(elements)) {
      isHydratingLayout = true;
      elements.forEach(renderLayoutElement);
      isHydratingLayout = false;
      updateCardPreview();
    }
  } catch { /* Keep the server-rendered fallback if persisted layout JSON is malformed. */ }
  finally { isHydratingLayout = false; }
}
document.getElementById('card-preview-mode')?.addEventListener('change', updateCardPreview);
syncLineOrder();
updateCardPreview();
`;
