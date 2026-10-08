export const panelScript = `document.addEventListener('change', (event) => {
  const control = event.target;
  if (!(control instanceof HTMLSelectElement)) return;
  const hintId = control.getAttribute('aria-describedby')?.split(/\\s+/).find((id) => id.endsWith('-selected-value'));
  if (!hintId) return;
  const hint = document.getElementById(hintId);
  if (!hint) return;
  const names = Array.from(control.selectedOptions)
    .filter((option) => option.value !== '')
    .map((option) => option.textContent?.trim() ?? '')
    .filter(Boolean);
  hint.textContent = names.length === 0 ? 'None selected.' : 'Selected: ' + names.join(', ');
});
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('[data-markdown-target]');
  if (!(button instanceof HTMLButtonElement)) return;
  const control = document.getElementById(button.dataset.markdownTarget ?? '');
  if (!(control instanceof HTMLTextAreaElement)) return;
  const marker = button.dataset.markdownMarker;
  if (!marker) return;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  const selected = control.value.slice(start, end) || 'text';
  const insertion = marker + selected + marker;
  const status = document.getElementById(control.id + '-format-status');
  if (control.maxLength >= 0 && control.value.length - (end - start) + insertion.length > control.maxLength) {
    if (status) status.textContent = 'Formatting would exceed the ' + control.maxLength + '-character limit. Shorten the description first.';
    return;
  }
  control.setRangeText(insertion, start, end, 'select');
  control.focus();
  control.setSelectionRange(start + marker.length, start + marker.length + selected.length);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  if (status) status.textContent = button.textContent + ' formatting added. Save the server to apply it.';
});
let focusedTemplate = null;
document.addEventListener('focusin', (event) => {
  if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-card-template]')) focusedTemplate = event.target;
});
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('[data-insert-placeholder]')) return;
  const picker = document.getElementById('card-placeholder-picker');
  if (!(picker instanceof HTMLSelectElement) || !(focusedTemplate instanceof HTMLTextAreaElement)) return;
  const token = picker.value;
  const start = focusedTemplate.selectionStart;
  const end = focusedTemplate.selectionEnd;
  if (focusedTemplate.maxLength >= 0 && focusedTemplate.value.length - (end - start) + token.length > focusedTemplate.maxLength) return;
  focusedTemplate.setRangeText(token, start, end, 'end');
  focusedTemplate.focus();
  focusedTemplate.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const resetTemplate = event.target.closest('[data-reset-template]');
  if (resetTemplate instanceof HTMLButtonElement) {
    const field = resetTemplate.dataset.resetTemplate + 'Template';
    const control = document.querySelector('[name="' + field + '"]');
    if (control instanceof HTMLTextAreaElement) {
      control.value = resetTemplate.dataset.resetValue ?? '';
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }
  const resetProfile = event.target.closest('[data-reset-card-profile]');
  if (!(resetProfile instanceof HTMLButtonElement)) return;
  let defaults;
  try { defaults = JSON.parse(resetProfile.dataset.defaults ?? '{}'); } catch { return; }
  for (const [name, value] of Object.entries(defaults)) {
    const control = document.querySelector('[name="' + name + '"]');
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === true;
    else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = String(value);
    control?.dispatchEvent(new Event('input', { bubbles: true }));
  }
  updateCardPreview();
});
const previewValues = { playercount: '0/5', players: '0', maxplayers: '5', online: '🟢 Online', status: 'Online', statusicon: '🟢', location: 'Dallas', serveraddress: 'clickcs1v1arena.pracc.club:26805', severaddress: 'clickcs1v1arena.pracc.club:26805', serverip: 'clickcs1v1arena.pracc.club', serverport: '26805', currentmap: 'aim_redline_fp', servername: 'Office Club 1v1 Arena', lastupdated: 'Just now' };
const previewRoot = document.getElementById('card-template-preview');
const previewModes = {
  online: { ...previewValues, status: 'Online', statusicon: '🟢', online: '🟢 Online' },
  offline: { ...previewValues, status: 'Offline', statusicon: '🔴', online: '🔴 Offline' },
  missing: { ...previewValues, playercount: 'Unknown', players: 'Unknown', maxplayers: 'Unknown', status: 'Unavailable', statusicon: '•', online: '• Unavailable', location: '', serveraddress: 'Unavailable', severaddress: 'Unavailable', serverip: 'Unavailable', serverport: 'Unavailable', currentmap: 'Unknown', lastupdated: 'Unknown' }
};
const updateCardPreview = () => {
  if (!(previewRoot instanceof HTMLElement)) return;
  const modeSelect = document.getElementById('card-preview-mode');
  const mode = modeSelect instanceof HTMLSelectElement ? modeSelect.value : 'current';
  let values = previewValues;
  if (mode === 'current') {
    try {
      const cached = JSON.parse(previewRoot.dataset.currentValues ?? 'null');
      values = cached === null ? previewValues : { ...previewValues, ...cached };
    } catch { values = previewValues; }
  } else values = previewModes[mode] ?? previewValues;
  if (mode !== 'current') {
    const statusName = mode === 'online' ? 'onlineStatusLabel' : mode === 'offline' ? 'offlineStatusLabel' : 'unavailableStatusLabel';
    const statusInput = document.querySelector('[name="' + statusName + '"]');
    if (statusInput instanceof HTMLInputElement) values = { ...values, status: statusInput.value, online: values.statusicon + ' ' + statusInput.value };
  }
  document.querySelectorAll('[data-card-template]').forEach((control) => {
    if (!(control instanceof HTMLTextAreaElement)) return;
    const key = control.id.replace('Template', '');
    const target = document.querySelector('[data-preview="' + key + '"]');
    if (!target) return;
    target.textContent = control.value.replace(/\\{([^{}]+)\\}/g, (_match, name) => values[name.toLowerCase()] ?? '');
    const visibility = document.querySelector('input[name="show' + key[0].toUpperCase() + key.slice(1) + '"]');
    target.hidden = visibility instanceof HTMLInputElement && !visibility.checked;
  });
};
document.addEventListener('input', (event) => { if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-card-template]')) updateCardPreview(); });
document.addEventListener('change', (event) => { if (event.target instanceof HTMLInputElement && event.target.name.startsWith('show')) updateCardPreview(); });
document.addEventListener('change', (event) => { if (event.target instanceof HTMLSelectElement && event.target.id === 'card-preview-mode') updateCardPreview(); });
updateCardPreview();
const cardForm = document.querySelector('form[action$="/edit"]');
if (cardForm instanceof HTMLFormElement) {
  const status = document.getElementById('card-config-dirty-status');
  const initial = new URLSearchParams(new FormData(cardForm)).toString();
  const updateDirtyState = () => {
    const dirty = new URLSearchParams(new FormData(cardForm)).toString() !== initial;
    if (status) status.textContent = dirty ? 'Unsaved changes. Save server to apply them.' : 'All changes saved.';
    cardForm.dataset.dirty = dirty ? 'true' : 'false';
  };
  cardForm.addEventListener('input', updateDirtyState);
  cardForm.addEventListener('change', updateDirtyState);
  window.addEventListener('beforeunload', (event) => {
    if (cardForm.dataset.dirty !== 'true') return;
    event.preventDefault();
    event.returnValue = '';
  });
}
`;
