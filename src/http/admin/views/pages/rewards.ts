import type { RewardDiagnosticCheck } from '../../../../modules/rewards/services/reward-diagnostics-service.js';
import {
  actionForm,
  adminShell,
  card,
  emptyState,
  escapeHtml,
  errorSummary,
  input,
  multiSelect,
  notice,
  options,
  select,
  statusBadge,
  table,
} from '../components.js';
import { formatTimestamp } from '../time.js';

export interface RewardsPageModel {
  id: string;
  name: string;
  username: string;
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
  textChannels: Array<{ id: string; name: string }>;
  voiceChannels: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  ledgerEntries: Array<{
    member: string;
    amount: number;
    source: string;
    actorDiscordUserId: string | null;
    reason: string | null;
    createdAt: Date;
  }>;
  diagnostics: RewardDiagnosticCheck[];
  inDevelopment: boolean;
  releaseVariant: string;
  errors?: string[];
  levelErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

export function rewardsPage(model: RewardsPageModel): string {
  const devNotice = model.inDevelopment
    ? notice(
        'Rewards is in development. Enable/disable is allowed, but configuration editing is read-only.',
        'warning',
      )
    : '';
  const errorBlock = errorSummary(model.errors ?? []);
  const moduleBody = `<p>Release: ${statusBadge('In development', model.releaseVariant)}</p><p>Operational: ${statusBadge(model.settings.enabled ? 'Enabled' : 'Disabled', model.settings.enabled ? 'enabled' : 'disabled')}</p>${model.settings.version === null ? '' : actionForm(`/admin/guilds/${escapeHtml(model.id)}/rewards/${model.settings.enabled ? 'disable' : 'enable'}`, model.csrf, `<input type="hidden" name="version" value="${String(model.settings.version)}"><button type="submit"${model.settings.enabled ? ' class="danger"' : ''}>${model.settings.enabled ? 'Disable' : 'Enable'}</button>`)}`;
  const action = `/admin/guilds/${escapeHtml(model.id)}/rewards`;
  const disabled = model.inDevelopment ? 'disabled' : '';
  const settingsForm = actionForm(
    `${action}/settings`,
    model.csrf,
    `<input type="hidden" name="version" value="${String(model.settings.version ?? 'new')}">
<fieldset class="card"><legend>Earning rules</legend>${input('Text XP', 'textXpAmount', model.settings.textXpAmount, 'number', `min="1" required ${disabled}`, model.fieldErrors?.textXpAmount)}${input('Text cooldown seconds', 'textCooldownSeconds', model.settings.textCooldownSeconds, 'number', `min="1" required ${disabled}`, model.fieldErrors?.textCooldownSeconds)}${input('Voice XP', 'voiceXpAmount', model.settings.voiceXpAmount, 'number', `min="1" required ${disabled}`, model.fieldErrors?.voiceXpAmount)}${input('Voice interval seconds', 'voiceIntervalSeconds', model.settings.voiceIntervalSeconds, 'number', `min="60" required ${disabled}`, model.fieldErrors?.voiceIntervalSeconds)}</fieldset>
<fieldset class="card"><legend>Eligible channels</legend>${multiSelect('Reward text channels', 'textChannelIds', model.textChannels, model.settings.textChannelIds, disabled, model.fieldErrors?.textChannelIds)}${multiSelect('Reward voice channels', 'voiceChannelIds', model.voiceChannels, model.settings.voiceChannelIds, disabled, model.fieldErrors?.voiceChannelIds)}</fieldset>
<fieldset class="card"><legend>Guild-tag reward</legend>${input('Guild-tag required seconds', 'tagRequiredSeconds', model.settings.tagRequiredSeconds, 'number', `min="60" required ${disabled}`, model.fieldErrors?.tagRequiredSeconds)}${select('Guild-tag reward role', 'tagRewardRoleId', model.roles, model.settings.tagRewardRoleId, `value="" ${disabled}`, 'None', model.fieldErrors?.tagRewardRoleId)}${input('Guild-tag reconcile seconds', 'tagReconcileSeconds', model.settings.tagReconcileSeconds, 'number', `min="60" required ${disabled}`, model.fieldErrors?.tagReconcileSeconds)}</fieldset>
${model.inDevelopment ? '' : '<button type="submit">Save reward settings</button>'}`,
  );
  const levelsForm = levelsCard(model, action, disabled);
  const adjustForm = model.inDevelopment
    ? ''
    : card(
        'Manual XP adjustment',
        actionForm(
          `${action}/adjust`,
          model.csrf,
          `<input type="hidden" name="adjustmentId" value="${escapeHtml(model.adjustmentId)}">${select('Member', 'discordUserId', model.members, '', 'required')}${input('Amount', 'amount', '', 'number', 'min="-1000000" max="1000000" required')}${input('Reason', 'reason', '', 'text', 'maxlength="500" required')}<button type="submit">Apply adjustment</button>`,
        ),
      );
  const ledgerRows = model.ledgerEntries.map((entry) => [
    escapeHtml(entry.member),
    escapeHtml(entry.source),
    String(entry.amount),
    escapeHtml(entry.actorDiscordUserId ?? 'system'),
    escapeHtml(entry.reason ?? ''),
    formatTimestamp(entry.createdAt),
  ]);
  const ledgerBody =
    model.ledgerEntries.length === 0
      ? emptyState('No ledger entries.')
      : table(['Member', 'Source', 'Amount', 'Actor', 'Reason', 'Time'], ledgerRows);
  const diagnostics = model.diagnostics
    .map(
      (check) =>
        `<li class="${check.ok ? 'ok' : 'bad'}">${escapeHtml(check.label)}: ${check.ok ? 'OK' : escapeHtml(check.detail ?? 'failed')}</li>`,
    )
    .join('');
  return adminShell(
    {
      title: `${model.name} · Rewards`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.id}/rewards`,
      currentGuildId: model.id,
    },
    `${devNotice}${errorBlock}` +
      card('Module status', moduleBody) +
      card('Reward settings', settingsForm) +
      levelsForm +
      adjustForm +
      card('Ledger', ledgerBody) +
      card('Diagnostics', `<ul>${diagnostics}</ul>`),
  );
}

function levelsCard(model: RewardsPageModel, action: string, disabled: string): string {
  const rows = model.levels
    .map(
      (level, index) =>
        `<tr>
<td><label><span class="level-field-label">Level</span><input type="number" name="levelNumbers" min="0" value="${String(level.level)}" ${disabled}></label></td>
<td><label><span class="level-field-label">XP threshold</span><input type="number" name="levelThresholds" min="0" value="${String(level.xpThreshold)}" ${disabled}></label></td>
<td><label><span class="level-field-label">Label</span><input type="text" name="levelLabels" maxlength="128" value="${escapeHtml(level.label ?? '')}" ${disabled}></label></td>
<td><label><span class="level-field-label">Role</span><select name="levelRoleIds" ${disabled}><option value="">None</option>${options(model.roles, level.roleId ?? '')}</select></label></td>
<td><button class="danger" type="submit" formaction="${escapeHtml(`${action}/levels/remove/${String(index)}`)}" ${disabled}>Remove</button></td>
</tr>`,
    )
    .join('');
  const errorBlock = errorSummary(model.levelErrors ?? []);
  const tableHtml = `<div class="table-wrap levels-table"><table><thead><tr><th>Level</th><th>XP threshold</th><th>Label</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const form = actionForm(
    `${action}/levels/add`,
    model.csrf,
    `${errorBlock}${tableHtml}
<div class="actions"><button type="submit" formaction="${escapeHtml(`${action}/levels/add`)}" ${disabled}>Add level</button>${model.inDevelopment ? '' : `<button type="submit" formaction="${escapeHtml(`${action}/levels/save`)}">Save levels</button>`}</div>`,
  );
  return card('Levels and roles', form);
}
