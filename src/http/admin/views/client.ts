import { cardLineScript } from './card-lines.js';

const applyTemplateFormatting = (
  control: {
    value: string;
    selectionStart: number;
    selectionEnd: number;
    setRangeText: (replacement: string, start: number, end: number, selectionMode?: string) => void;
    setSelectionRange: (start: number, end: number) => void;
  },
  marker: string,
  clear = false,
) => {
  const source = control.value;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  if (clear) {
    if (start === end) return false;
    const selected = source.slice(start, end);
    const wrappers = ['***', '**', '__', '~~', '||', '*', String.fromCharCode(96)];
    for (const wrapper of wrappers) {
      if (
        selected.startsWith(wrapper) &&
        selected.endsWith(wrapper) &&
        selected.length >= wrapper.length * 2
      ) {
        const inner = selected.slice(wrapper.length, -wrapper.length);
        control.setRangeText(inner, start, end, 'select');
        control.setSelectionRange(start, start + inner.length);
        return true;
      }
      if (
        start >= wrapper.length &&
        source.slice(start - wrapper.length, start) === wrapper &&
        source.slice(end, end + wrapper.length) === wrapper
      ) {
        const from = start - wrapper.length;
        const to = end + wrapper.length;
        control.setRangeText(selected, from, to, 'select');
        control.setSelectionRange(from, from + selected.length);
        return true;
      }
    }
    return false;
  }
  const selected = source.slice(start, end);
  const content = selected || 'text';
  control.setRangeText(marker + content + marker, start, end, 'select');
  control.setSelectionRange(start + marker.length, start + marker.length + content.length);
  return true;
};

export const panelScript = `${applyTemplateFormatting.toString()};
document.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement) || !event.target.querySelector('[data-confirm-deployment-remove]')) return;
  if (!window.confirm('Remove this Discord display? The server registration and card configuration will remain saved.')) event.preventDefault();
});
document.addEventListener('change', (event) => {
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
  const status = document.getElementById(control.id + '-format-status');
  const start = control.selectionStart;
  const selected = control.value.slice(control.selectionStart, control.selectionEnd);
  const selectedLength = control.selectionEnd - control.selectionStart;
  const contentLength = selectedLength || 'text'.length;
  const newLength = control.value.length - selectedLength + contentLength + marker.length * 2;
  if (control.maxLength >= 0 && newLength > control.maxLength) {
    if (status) status.textContent = 'Formatting would exceed the ' + control.maxLength + '-character limit. Shorten the template first.';
    return;
  }
  applyTemplateFormatting(control, marker);
  control.focus();
  control.setSelectionRange(start + marker.length, start + marker.length + selected.length);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  if (status) status.textContent = button.textContent + ' formatting added. Save the server to apply it.';
});
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('[data-markdown-clear]');
  if (!(button instanceof HTMLButtonElement)) return;
  const control = document.getElementById(button.dataset.markdownClear ?? '');
  if (!(control instanceof HTMLTextAreaElement)) return;
  const status = document.getElementById(control.id + '-format-status');
  if (!applyTemplateFormatting(control, '', true)) {
    if (status) status.textContent = 'Select formatted text to clear its formatting.';
    return;
  }
  control.focus();
  control.dispatchEvent(new Event('input', { bubbles: true }));
  if (status) status.textContent = 'Formatting removed. Save the server to apply it.';
});
${cardLineScript}`;
