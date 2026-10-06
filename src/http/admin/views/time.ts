import { escapeHtml } from './components.js';

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function formatTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `<time datetime="${iso}" title="${iso}">${escapeHtml(timestampFormatter.format(date))} UTC</time>`;
}
