import {
  actionForm,
  adminShell,
  card,
  emptyState,
  escapeHtml,
  statusBadge,
  table,
} from '../components.js';
import { formatTimestamp } from '../time.js';

export interface GeneralPageModel {
  id: string;
  name: string;
  username: string;
  csrf: string;
  discordAvailable: boolean;
  modules: Array<{
    key: string;
    label: string;
    href: string;
    release: string;
    releaseVariant: string;
    operational: string;
    operationalVariant: string;
    configured: boolean;
    enabled: boolean;
    version: number | null;
    primaryAction?: { label: string; href: string } | undefined;
  }>;
  recentAudit: Array<{
    createdAt: Date;
    actor: string | null;
    module: string;
    action: string;
    result: string;
  }>;
}

function moduleToggle(
  model: GeneralPageModel,
  module: GeneralPageModel['modules'][number],
): string {
  if (!module.configured || module.version === null) {
    return '';
  }
  if (module.key === 'game-servers' && module.enabled) {
    return `<a class="button danger" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/disable-confirm">Disable</a>`;
  }
  const action = module.enabled ? 'disable' : 'enable';
  return actionForm(
    `/admin/guilds/${escapeHtml(model.id)}/${module.key}/${action}`,
    model.csrf,
    `<input type="hidden" name="version" value="${String(module.version)}"><button type="submit"${module.enabled ? ' class="danger"' : ''}>${module.enabled ? 'Disable' : 'Enable'}</button>`,
  );
}

export function generalPage(model: GeneralPageModel): string {
  const status = model.discordAvailable
    ? statusBadge('Connected', 'enabled')
    : statusBadge('Unavailable', 'unavailable');
  const moduleCards = model.modules
    .map(
      (module) =>
        `<div class="module-card"><h3><a href="${escapeHtml(module.href)}">${escapeHtml(module.label)}</a></h3><p>${statusBadge(module.release, module.releaseVariant)} ${statusBadge(module.operational, module.operationalVariant)}</p><div class="actions">${moduleToggle(model, module)}${module.primaryAction === undefined ? '' : `<a class="button" href="${escapeHtml(module.primaryAction.href)}">${escapeHtml(module.primaryAction.label)}</a>`}</div></div>`,
    )
    .join('');
  const auditBody =
    model.recentAudit.length === 0
      ? emptyState('No recent audit activity.')
      : table(
          ['Time', 'Actor', 'Module', 'Action', 'Result'],
          model.recentAudit.map((entry) => [
            formatTimestamp(entry.createdAt),
            escapeHtml(entry.actor ?? 'system'),
            escapeHtml(entry.module),
            escapeHtml(entry.action),
            escapeHtml(entry.result),
          ]),
        );
  return adminShell(
    {
      title: model.name,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.id}`,
      currentGuildId: model.id,
    },
    `<header class="card"><h1>${escapeHtml(model.name)}</h1><p>Discord gateway: ${status}</p></header>` +
      card('Modules', `<div class="module-grid">${moduleCards}</div>`) +
      card('Recent audit activity', auditBody),
  );
}
