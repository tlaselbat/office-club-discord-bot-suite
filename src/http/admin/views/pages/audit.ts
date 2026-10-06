import { adminShell, card, emptyState, escapeHtml, table } from '../components.js';

export interface AuditPageModel {
  id: string;
  name: string;
  username: string;
  csrf: string;
  entries: Array<{
    createdAt: Date;
    actor: string | null;
    module: string;
    action: string;
    result: string;
    summary: string;
  }>;
}

export function auditPage(model: AuditPageModel): string {
  const body =
    model.entries.length === 0
      ? emptyState('No audit activity for this guild.')
      : table(
          ['Time', 'Actor', 'Module', 'Action', 'Outcome', 'Summary'],
          model.entries.map((entry) => [
            escapeHtml(entry.createdAt.toISOString()),
            escapeHtml(entry.actor ?? 'system'),
            escapeHtml(entry.module),
            escapeHtml(entry.action),
            escapeHtml(entry.result),
            escapeHtml(entry.summary),
          ]),
        );
  return adminShell(
    {
      title: `${model.name} · Audit`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.id}/audit`,
      currentGuildId: model.id,
    },
    card('Audit activity', body),
  );
}
