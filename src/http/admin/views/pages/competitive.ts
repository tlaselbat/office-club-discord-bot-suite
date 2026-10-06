import type { DiagnosticsReport } from '../../../../modules/tenman/services/diagnostics-service.js';
import {
  actionForm,
  adminShell,
  card,
  escapeHtml,
  errorSummary,
  hiddenCsrf,
  input,
  multiSelect,
  notice,
  select,
  statusBadge,
} from '../components.js';

export interface CompetitivePageModel {
  id: string;
  name: string;
  username: string;
  csrf: string;
  version: number | null;
  enabled: boolean;
  release: string;
  releaseVariant: string;
  managedState: string;
  locked: boolean;
  inDevelopment: boolean;
  values: Record<string, string | string[]>;
  textChannels: Array<{ id: string; name: string }>;
  voiceChannels: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
  profiles: Array<{ id: string; name: string }>;
  diagnostics?: DiagnosticsReport;
  errors?: string[];
}

export function competitivePage(model: CompetitivePageModel): string {
  const value = (key: string): string | string[] => model.values[key] ?? '';
  const lockedNotice = model.locked
    ? notice(
        'Managed resources exist. Use Discord commands for recovery or teardown. Configuration is read-only.',
        'warning',
      )
    : '';
  const devNotice = model.inDevelopment
    ? notice(
        'Competitive is in development. Enable/disable is allowed, but configuration editing is read-only.',
        'warning',
      )
    : '';
  const errorBlock = errorSummary(model.errors ?? []);
  const moduleBody = `<p>Release: ${statusBadge(model.release, model.releaseVariant)}</p><p>Operational: ${statusBadge(model.enabled ? 'Enabled' : 'Disabled', model.enabled ? 'enabled' : 'disabled')}</p>${model.version === null ? '' : actionForm(`/admin/guilds/${escapeHtml(model.id)}/competitive/${model.enabled ? 'disable' : 'enable'}`, model.csrf, `<input type="hidden" name="version" value="${String(model.version ?? 0)}"><button type="submit">${model.enabled ? 'Disable' : 'Enable'}</button>`)}`;
  const diagnosticsBody =
    model.diagnostics === undefined
      ? '<p class="empty">Run diagnostics to see a live report.</p>'
      : diagnosticsView(model.diagnostics);
  const readOnly = model.locked || model.inDevelopment;
  const attr = readOnly ? 'disabled' : 'required';
  const channelAttr = readOnly ? 'disabled' : '';
  const form = actionForm(
    `/admin/guilds/${escapeHtml(model.id)}/competitive/settings`,
    model.csrf,
    `<input type="hidden" name="version" value="${String(model.version ?? 'new')}">
<fieldset class="card"><legend>Discord channels</legend>${select('Lobby text channel', 'lobbyTextChannelId', model.textChannels, value('lobbyTextChannelId'), attr)}${select('Lobby voice channel', 'lobbyVoiceChannelId', model.voiceChannels, value('lobbyVoiceChannelId'), attr)}${select('Team 1 voice channel', 'team1VoiceChannelId', model.voiceChannels, value('team1VoiceChannelId'), attr)}${select('Team 2 voice channel', 'team2VoiceChannelId', model.voiceChannels, value('team2VoiceChannelId'), attr)}</fieldset>
<fieldset class="card"><legend>Staff roles</legend>${multiSelect('Privileged roles', 'privilegedRoleIds', model.roles, value('privilegedRoleIds'), channelAttr)}${multiSelect('Moderator roles', 'moderatorRoleIds', model.roles, value('moderatorRoleIds'), channelAttr)}${multiSelect('Administrator roles', 'administratorRoleIds', model.roles, value('administratorRoleIds'), channelAttr)}</fieldset>
<fieldset class="card"><legend>DatHost / profile</legend>${input('DatHost template ID', 'dathostTemplateServerId', String(value('dathostTemplateServerId')), 'text', attr)}${input('Default server location', 'defaultServerLocation', String(value('defaultServerLocation')), 'text', attr)}${select('Default game profile', 'defaultGameProfileKey', model.profiles, value('defaultGameProfileKey'), attr)}</fieldset>
${readOnly ? '' : `<button type="submit">Save settings</button>`}`,
  );
  const managedBody = `<p>Managed resource state: <strong>${escapeHtml(model.managedState)}</strong></p>${managedGuidance(model.managedState)}`;
  return adminShell(
    {
      title: `${model.name} · Competitive`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.id}/competitive`,
      currentGuildId: model.id,
    },
    `${devNotice}${lockedNotice}${errorBlock}` +
      card('Module status', moduleBody) +
      card('Configuration', form) +
      card('Managed resources', managedBody) +
      card(
        'Diagnostics',
        `<form method="post" action="/admin/guilds/${escapeHtml(model.id)}/competitive/diagnostics">${hiddenCsrf(model.csrf)}<button type="submit">Run diagnostics</button></form>${diagnosticsBody}`,
      ),
  );
}

function managedGuidance(state: string): string {
  switch (state) {
    case 'NONE':
      return '<p>Use <code>/match config setup</code> in Discord to create managed channels and roles.</p>';
    case 'SETTING_UP':
      return '<p>Setup was interrupted. Run <code>/match config recover-setup</code> in Discord to resume, or tear down and start over.</p>';
    case 'ACTIVE':
      return '<p>Managed channels are active. To remove them, run <code>/match config teardown</code> in Discord. Do not delete channels manually unless recovery guidance says so.</p>';
    case 'TEARING_DOWN':
      return '<p>Teardown is in progress. Monitor status in Discord; run <code>/match config teardown</code> again if it stalls.</p>';
    default:
      return '<p>Use Discord commands to manage these resources.</p>';
  }
}

function diagnosticsView(report: DiagnosticsReport): string {
  const checks = [...report.channels, ...report.roles, ...report.permissions]
    .map((check) => {
      const detail =
        'error' in check ? check.error : 'missing' in check ? check.missing.join(', ') : undefined;
      return `<li class="${check.ok ? 'ok' : 'bad'}">${escapeHtml(check.label)}: ${check.ok ? 'OK' : escapeHtml(detail ?? 'failed')}</li>`;
    })
    .join('');
  return `<ul>${checks}</ul>${report.template === undefined ? '' : `<p>Template: ${report.template.ok ? 'OK' : escapeHtml(report.template.error ?? 'failed')}</p>`}`;
}
