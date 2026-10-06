export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface NavLink {
  id: string;
  label: string;
  href: string;
}

export interface GuildOption {
  id: string;
  name: string;
}

export interface ShellOptions {
  title: string;
  username: string;
  csrf: string;
  currentPath: string;
  currentGuildId?: string | undefined;
  guilds?: GuildOption[] | undefined;
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Office Club</title><link rel="stylesheet" href="/admin/assets/panel.css"></head><body><main>${body}</main></body></html>`;
}

export function adminShell(options: ShellOptions, body: string): string {
  const guildHeading =
    options.currentGuildId === undefined
      ? ''
      : `<p class="guild-back"><a href="/admin">← All guilds</a></p>`;
  const nav = navLinks(options.currentPath, options.currentGuildId);
  const header = `<header class="site-header"><div class="brand"><h1>Office Club owner panel</h1><p>Signed in as ${escapeHtml(options.username)}</p></div><form method="post" action="/admin/logout" class="logout">${hiddenCsrf(options.csrf)}<button>Sign out</button></form></header><nav class="module-nav" aria-label="Modules">${nav}</nav>${guildHeading}`;
  return page(options.title, `${header}${body}`);
}

function navLinks(currentPath: string, guildId?: string): string {
  const base = guildId === undefined ? '/admin' : `/admin/guilds/${escapeHtml(guildId)}`;
  const links: NavLink[] = [
    { id: 'overview', label: 'Overview', href: base },
    { id: 'game-servers', label: 'Game Servers', href: `${base}/game-servers` },
    { id: 'competitive', label: 'Competitive', href: `${base}/competitive` },
    { id: 'rewards', label: 'Rewards', href: `${base}/rewards` },
    { id: 'audit', label: 'Audit', href: `${base}/audit` },
  ];
  return `<ul>${links
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.href)}"${currentPath.startsWith(link.href) ? ' aria-current="page"' : ''}>${escapeHtml(link.label)}</a></li>`,
    )
    .join('')}</ul>`;
}

export function hiddenCsrf(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

export function notice(
  message: string,
  variant: 'success' | 'warning' | 'error' = 'success',
): string {
  return `<p class="notice ${variant}">${escapeHtml(message)}</p>`;
}

export function emptyState(message: string): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

export interface Option {
  id: string;
  name: string;
}

export function options(
  items: Option[],
  selected: string | string[],
  placeholder?: string,
): string {
  const values = new Set(Array.isArray(selected) ? selected : [selected]);
  const placeholderOption =
    placeholder === undefined ? '' : `<option value="">${escapeHtml(placeholder)}</option>`;
  return `${placeholderOption}${items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}"${values.has(item.id) ? ' selected' : ''}>${escapeHtml(item.name)}</option>`,
    )
    .join('')}`;
}

export function select(
  label: string,
  name: string,
  items: Option[],
  selected: string | string[],
  attributes = '',
  placeholder?: string,
  errors?: string[],
): string {
  const errorHtml = fieldErrors(name, errors);
  return `<label for="${name}">${escapeHtml(label)}${errorHtml}<select id="${name}" name="${name}" ${attributes}>${options(items, selected, placeholder)}</select></label>`;
}

export function multiSelect(
  label: string,
  name: string,
  items: Option[],
  selected: string | string[],
  attributes = '',
  errors?: string[],
): string {
  const summary = selectedSummary(selected, items);
  const errorHtml = fieldErrors(name, errors);
  return `<div class="field"><label for="${name}">${escapeHtml(label)}</label><p class="hint">Hold Ctrl / Cmd to select multiple. ${summary}</p>${errorHtml}<select id="${name}" name="${name}" multiple ${attributes}>${options(items, selected)}</select></div>`;
}

export function selectedSummary(selected: string | string[], items: Option[]): string {
  const values = Array.isArray(selected) ? selected : [selected].filter((id) => id !== '');
  if (values.length === 0) return 'None selected.';
  const names = values
    .map((id) => items.find((item) => item.id === id)?.name ?? id)
    .map((name) => escapeHtml(name));
  return `Selected: ${names.join(', ')}`;
}

export function input(
  label: string,
  name: string,
  value: string | number,
  type = 'text',
  attributes = '',
  errors?: string[],
): string {
  const errorHtml = fieldErrors(name, errors);
  const safeValue = escapeHtml(String(value));
  return `<label for="${name}">${escapeHtml(label)}${errorHtml}<input id="${name}" type="${type}" name="${name}" value="${safeValue}" ${attributes}></label>`;
}

export function checkbox(
  label: string,
  name: string,
  checked: boolean,
  value = '1',
  attributes = '',
  errors?: string[],
): string {
  const errorHtml = fieldErrors(name, errors);
  return `<label class="checkbox">${errorHtml}<input type="checkbox" name="${name}" value="${escapeHtml(value)}"${checked ? ' checked' : ''} ${attributes}> ${escapeHtml(label)}</label>`;
}

export function fieldErrors(name: string, errors?: string[]): string {
  if (errors === undefined || errors.length === 0) return '';
  return `<span class="field-error" id="${name}-error">${escapeHtml(errors.join('. '))}</span>`;
}

export function errorSummary(errors: string[]): string {
  if (errors.length === 0) return '';
  return `<div class="error-summary" role="alert"><h2>Check the following</h2><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>`;
}

export function statusBadge(status: string, variant?: string): string {
  const safeVariant = variant ?? status.toLowerCase().replace(/\s+/g, '-');
  return `<span class="badge ${escapeHtml(safeVariant)}">${escapeHtml(status)}</span>`;
}

export function card(title: string, body: string, attributes = ''): string {
  return `<section class="card" ${attributes}><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

export function actionForm(action: string, csrf: string, body: string, method = 'post'): string {
  return `<form method="${method}" action="${escapeHtml(action)}">${hiddenCsrf(csrf)}${body}</form>`;
}

export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '';
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<div class="table-wrap"><table>${head}${body}</table></div>`;
}

export function definitionList(items: Array<[string, string]>): string {
  return `<dl class="dl">${items.map(([term, definition]) => `<dt>${escapeHtml(term)}</dt><dd>${definition}</dd>`).join('')}</dl>`;
}
