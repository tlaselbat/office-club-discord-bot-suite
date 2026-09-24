import type { DiagnosticsReport } from '../../modules/tenman/services/diagnostics-service.js';
import type { RewardDiagnosticCheck } from '../../modules/rewards/services/reward-diagnostics-service.js';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Office Club</title><link rel="stylesheet" href="/admin/assets/panel.css"></head><body><main>${body}</main></body></html>`;
}

export function loginPage(href: string): string {
  return page(
    'Owner sign in',
    `<section class="card narrow"><h1>Office Club owner panel</h1><p>Sign in with the allowlisted Discord owner account.</p><a class="button" href="${escapeHtml(href)}">Sign in with Discord</a></section>`,
  );
}

export interface GuildSummary {
  id: string;
  name: string;
  tenManConfigured: boolean;
  tenManEnabled: boolean;
  rewardsConfigured: boolean;
  rewardsEnabled: boolean;
  managedState: string;
}

export function guildIndex(username: string, csrf: string, guilds: GuildSummary[]): string {
  const rows = guilds
    .map(
      (guild) =>
        `<tr><td><a href="/admin/guilds/${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</a></td><td>${guild.tenManConfigured ? (guild.tenManEnabled ? 'Enabled' : 'Disabled') : 'Unconfigured'}</td><td>${guild.rewardsConfigured ? (guild.rewardsEnabled ? 'Enabled' : 'Disabled') : 'Unconfigured'}</td><td>${escapeHtml(guild.managedState)}</td></tr>`,
    )
    .join('');
  return page(
    'Guilds',
    `<header><div><h1>Guilds</h1><p>Signed in as ${escapeHtml(username)}</p></div><form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>Log out</button></form></header><section class="card"><table><thead><tr><th>Guild</th><th>Competitive</th><th>Rewards</th><th>Resources</th></tr></thead><tbody>${rows}</tbody></table></section>`,
  );
}

interface Option {
  id: string;
  name: string;
}
export interface GuildPageModel {
  id: string;
  name: string;
  version: number | null;
  enabled: boolean;
  managedState: string;
  values: Record<string, string | string[]>;
  textChannels: Option[];
  voiceChannels: Option[];
  roles: Option[];
  profiles: Option[];
  csrf: string;
  notice?: string;
  diagnostics?: DiagnosticsReport;
}

function options(items: Option[], selected: string | string[]): string {
  const values = new Set(Array.isArray(selected) ? selected : [selected]);
  return items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}"${values.has(item.id) ? ' selected' : ''}>${escapeHtml(item.name)}</option>`,
    )
    .join('');
}

export function guildPage(model: GuildPageModel): string {
  const value = (key: string): string | string[] => model.values[key] ?? '';
  const locked = model.managedState !== 'NONE';
  const report = model.diagnostics === undefined ? '' : diagnosticsView(model.diagnostics);
  return page(
    model.name,
    `<header><div><a href="/admin">← Guilds</a><h1>${escapeHtml(model.name)}</h1><p>${model.version === null ? 'Unconfigured' : model.enabled ? 'Enabled' : 'Disabled'} · Managed resources: ${escapeHtml(model.managedState)}</p></div></header>${model.notice === undefined ? '' : `<p class="notice">${escapeHtml(model.notice)}</p>`}${locked ? '<p class="warning">Manual editing is unavailable while bot-managed resources exist. Use Discord for recovery or teardown.</p>' : ''}<section class="card"><h2>Modules</h2><p><a class="button" href="/admin/guilds/${escapeHtml(model.id)}/rewards">Configure Member Rewards</a></p></section><section class="card"><h2>Configuration</h2><form method="post" action="/admin/guilds/${escapeHtml(model.id)}/settings"><input type="hidden" name="csrf" value="${escapeHtml(model.csrf)}"><input type="hidden" name="version" value="${String(model.version ?? 'new')}"><label>Lobby text channel<select name="lobbyTextChannelId" required>${options(model.textChannels, value('lobbyTextChannelId'))}</select></label><label>Lobby voice channel<select name="lobbyVoiceChannelId" required>${options(model.voiceChannels, value('lobbyVoiceChannelId'))}</select></label><label>Team 1 voice channel<select name="team1VoiceChannelId" required>${options(model.voiceChannels, value('team1VoiceChannelId'))}</select></label><label>Team 2 voice channel<select name="team2VoiceChannelId" required>${options(model.voiceChannels, value('team2VoiceChannelId'))}</select></label><label>Privileged roles<select name="privilegedRoleIds" multiple required>${options(model.roles, value('privilegedRoleIds'))}</select></label><label>Moderator roles<select name="moderatorRoleIds" multiple required>${options(model.roles, value('moderatorRoleIds'))}</select></label><label>Administrator roles<select name="administratorRoleIds" multiple required>${options(model.roles, value('administratorRoleIds'))}</select></label><label>DatHost template ID<input name="dathostTemplateServerId" maxlength="128" required value="${escapeHtml(value('dathostTemplateServerId'))}"></label><label>DatHost location<input name="defaultServerLocation" maxlength="64" value="${escapeHtml(value('defaultServerLocation'))}"></label><label>Default profile<select name="defaultGameProfileKey" required>${options(model.profiles, value('defaultGameProfileKey'))}</select></label><button${locked ? ' disabled' : ''}>Save configuration</button></form></section><section class="actions"><form method="post" action="/admin/guilds/${escapeHtml(model.id)}/${model.enabled ? 'disable' : 'enable'}"><input type="hidden" name="csrf" value="${escapeHtml(model.csrf)}"><button${model.version === null ? ' disabled' : ''}>${model.enabled ? 'Disable' : 'Enable'}</button></form><form method="post" action="/admin/guilds/${escapeHtml(model.id)}/diagnostics"><input type="hidden" name="csrf" value="${escapeHtml(model.csrf)}"><button>Run diagnostics</button></form></section>${report}`,
  );
}

export interface RewardsPageModel {
  id: string;
  name: string;
  csrf: string;
  adjustmentId: string;
  settings: {
    version: number | null;
    enabled: boolean;
    textXpAmount: number;
    textCooldownSeconds: number;
    voiceXpAmount: number;
    voiceIntervalSeconds: number;
    textChannelIds: string[];
    voiceChannelIds: string[];
    tagRequiredSeconds: number;
    tagRewardRoleId: string;
    tagReconcileSeconds: number;
  };
  levels: Array<{
    level: number;
    xpThreshold: number;
    label: string | null;
    roleId: string | null;
  }>;
  textChannels: Option[];
  voiceChannels: Option[];
  roles: Option[];
  members: Option[];
  ledgerEntries: Array<{
    member: string;
    amount: number;
    source: string;
    actorDiscordUserId: string | null;
    reason: string | null;
    createdAt: Date;
  }>;
  diagnostics: RewardDiagnosticCheck[];
}

export function rewardsPage(model: RewardsPageModel): string {
  const levelRows = Array.from(
    { length: Math.max(10, model.levels.length + 1) },
    (_, index) => model.levels[index] ?? null,
  )
    .map(
      (level) =>
        `<tr><td><input type="number" min="0" name="levelNumbers" value="${level === null ? '' : String(level.level)}"></td><td><input type="number" min="0" name="levelThresholds" value="${level === null ? '' : String(level.xpThreshold)}"></td><td><input name="levelLabels" maxlength="128" value="${escapeHtml(level?.label ?? '')}"></td><td><select name="levelRoleIds"><option value="">None</option>${options(model.roles, level?.roleId ?? '')}</select></td></tr>`,
    )
    .join('');
  const action = `/admin/guilds/${escapeHtml(model.id)}/rewards`;
  const ledgerRows = model.ledgerEntries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.member)}</td><td>${escapeHtml(entry.source)}</td><td>${String(entry.amount)}</td><td>${escapeHtml(entry.actorDiscordUserId ?? 'system')}</td><td>${escapeHtml(entry.reason ?? '')}</td><td>${escapeHtml(entry.createdAt.toISOString())}</td></tr>`,
    )
    .join('');
  const diagnostics = model.diagnostics
    .map(
      (check) =>
        `<li class="${check.ok ? 'ok' : 'bad'}">${escapeHtml(check.label)}: ${check.ok ? 'OK' : escapeHtml(check.detail ?? 'failed')}</li>`,
    )
    .join('');
  return page(
    `${model.name} rewards`,
    `<header><div><a href="/admin/guilds/${escapeHtml(model.id)}">← Server settings</a><h1>Member Rewards</h1><p>${model.settings.enabled ? 'Enabled' : 'Disabled'}</p></div></header><section class="card"><div class="actions"><h2>Module</h2><form method="post" action="${action}/${model.settings.enabled ? 'disable' : 'enable'}"><input type="hidden" name="csrf" value="${escapeHtml(model.csrf)}"><input type="hidden" name="version" value="${String(model.settings.version ?? 0)}"><button${model.settings.version === null ? ' disabled' : ''}>${model.settings.enabled ? 'Disable' : 'Enable'}</button></form></div></section><section class="card"><h2>Reward settings</h2><form method="post" action="${action}/settings"><input type="hidden" name="csrf" value="${escapeHtml(model.csrf)}"><input type="hidden" name="version" value="${String(model.settings.version ?? 'new')}"><label>Text XP<input type="number" name="textXpAmount" min="1" value="${String(model.settings.textXpAmount)}" required></label><label>Text cooldown seconds<input type="number" name="textCooldownSeconds" min="1" value="${String(model.settings.textCooldownSeconds)}" required></label><label>Reward text channels<select name="textChannelIds" multiple>${options(model.textChannels, model.settings.textChannelIds)}</select></label><label>Voice XP<input type="number" name="voiceXpAmount" min="1" value="${String(model.settings.voiceXpAmount)}" required></label><label>Voice interval seconds<input type="number" name="voiceIntervalSeconds" min="60" value="${String(model.settings.voiceIntervalSeconds)}" required></label><label>Reward voice channels<select name="voiceChannelIds" multiple>${options(model.voiceChannels, model.settings.voiceChannelIds)}</select></label><label>Guild-tag required seconds<input type="number" name="tagRequiredSeconds" min="60" value="${String(model.settings.tagRequiredSeconds)}" required></label><label>Guild-tag reward role<select name="tagRewardRoleId"><option value="">None</option>${options(model.roles, model.settings.tagRewardRoleId)}</select></label><label>Tag reconciliation seconds<input type="number" name="tagReconcileSeconds" min="60" value="${String(model.settings.tagReconcileSeconds)}" required></label><fieldset><legend>Levels</legend><table><thead><tr><th>Level</th><th>XP threshold</th><th>Label</th><th>Role</th></tr></thead><tbody>${levelRows}</tbody></table></fieldset><button>Save rewards</button></form></section><section class="card"><h2>Manual XP adjustment</h2><form method="post" action="${action}/adjust"><label>Member<select name="discordUserId" required>${options(model.members, '')}</select></label><label>Amount<input type="number" name="amount" required></label><label>Reason<input name="reason" maxlength="500" required></label><input type="hidden" name="csrf" value="${escapeHtml(model.csrf)}"><input type="hidden" name="adjustmentId" value="${escapeHtml(model.adjustmentId)}"><button>Apply adjustment</button></form></section><section class="card"><h2>Recent reward ledger</h2><table><thead><tr><th>Member</th><th>Source</th><th>Amount</th><th>Actor</th><th>Reason</th><th>Time</th></tr></thead><tbody>${ledgerRows}</tbody></table></section><section class="card"><h2>Rewards diagnostics</h2><ul>${diagnostics}</ul></section>`,
  );
}

function diagnosticsView(report: DiagnosticsReport): string {
  const checks = [...report.channels, ...report.roles, ...report.permissions]
    .map((check) => {
      const detail =
        'error' in check ? check.error : 'missing' in check ? check.missing.join(', ') : undefined;
      return `<li class="${check.ok ? 'ok' : 'bad'}">${escapeHtml(check.label)}: ${check.ok ? 'OK' : escapeHtml(detail ?? 'failed')}</li>`;
    })
    .join('');
  return `<section class="card"><h2>Diagnostics</h2><ul>${checks}</ul>${report.template === undefined ? '' : `<p>Template: ${report.template.ok ? 'OK' : escapeHtml(report.template.error ?? 'failed')}</p>`}</section>`;
}

export const panelCss = `:root{font-family:system-ui,sans-serif;color:#e8edf4;background:#0d1117}body{margin:0}main{max-width:1050px;margin:auto;padding:2rem}header,.actions{display:flex;justify-content:space-between;align-items:center;gap:1rem}.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.25rem;margin:1rem 0}.narrow{max-width:32rem;margin:15vh auto}form{display:grid;gap:1rem}label{display:grid;gap:.35rem}input,select,button,.button{font:inherit;color:inherit;background:#21262d;border:1px solid #484f58;border-radius:6px;padding:.65rem}.button{display:inline-block;text-decoration:none}button,.button{cursor:pointer;width:max-content}button:focus,a:focus,input:focus,select:focus{outline:3px solid #58a6ff;outline-offset:2px}button:disabled{opacity:.5;cursor:not-allowed}select[multiple]{min-height:8rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.75rem;border-bottom:1px solid #30363d}a{color:#58a6ff}.notice{background:#16351f;padding:1rem}.warning,.bad{color:#ffb4a8}.ok{color:#7ee787}@media(max-width:650px){main{padding:1rem}header,.actions{align-items:stretch;flex-direction:column}.card{overflow:auto}}`;
