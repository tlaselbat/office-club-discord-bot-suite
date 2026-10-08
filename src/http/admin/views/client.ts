import { cardLineScript } from './card-lines.js';

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
    if (status) status.textContent = 'Formatting would exceed the ' + control.maxLength + '-character limit. Shorten the template first.';
    return;
  }
  control.setRangeText(insertion, start, end, 'select');
  control.focus();
  control.setSelectionRange(start + marker.length, start + marker.length + selected.length);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  if (status) status.textContent = button.textContent + ' formatting added. Save the server to apply it.';
});
${cardLineScript}`;
