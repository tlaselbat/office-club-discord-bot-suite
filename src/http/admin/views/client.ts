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
});`;
