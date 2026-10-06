import { adminShell, card, emptyState, escapeHtml, statusBadge, table } from '../components.js';

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

export function generalPage(model: GeneralPageModel): string {
  const status = model.discordAvailable
    ? statusBadge('Connected', 'enabled')
    : statusBadge('Unavailable', 'unavailable');
  const moduleCards = model.modules
    .map(
      (module) =>
        `<div class="module-card"><h3><a href="${escapeHtml(module.href)}">${escapeHtml(module.label)}</a></h3><p>${statusBadge(module.release, module.releaseVariant)} ${statusBadge(module.operational, module.operationalVariant)}</p>${module.primaryAction === undefined ? '' : `<p class="actions"><a class="button${module.operationalVariant === 'in-development' ? ' disabled' : ''}" href="${escapeHtml(module.primaryAction.href)}">${escapeHtml(module.primaryAction.label)}</a></p>`}</div>`,
    )
    .join('');
  const auditBody =
    model.recentAudit.length === 0
      ? emptyState('No recent audit activity.')
      : table(
          ['Time', 'Actor', 'Module', 'Action', 'Result'],
          model.recentAudit.map((entry) => [
            escapeHtml(entry.createdAt.toISOString()),
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
    `<header class="card"><h2>${escapeHtml(model.name)}</h2><p>Discord gateway: ${status}</p></header>` +
      card('Modules', `<div class="module-grid">${moduleCards}</div>`) +
      card('Recent audit activity', auditBody),
  );
}
