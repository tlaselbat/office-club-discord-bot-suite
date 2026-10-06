export {
  escapeHtml,
  page,
  adminShell,
  notice,
  emptyState,
  statusBadge,
  card,
  table,
  errorSummary,
  select,
  multiSelect,
  input,
  actionForm,
  hiddenCsrf,
  options,
  selectedSummary,
  type Option,
  type ShellOptions,
} from './views/components.js';
export { panelCss } from './views/styles.js';
export { guildIndex, type GuildSummary } from './views/pages/guild-index.js';
export { generalPage, type GeneralPageModel } from './views/pages/general.js';
export { competitivePage, type CompetitivePageModel } from './views/pages/competitive.js';
export { rewardsPage, type RewardsPageModel } from './views/pages/rewards.js';
export { auditPage, type AuditPageModel } from './views/pages/audit.js';
export {
  gameServersPage,
  gameServerEditPage,
  disableModuleConfirmPage,
  removeServerConfirmPage,
  type GameServersPageModel,
  type GameServerEditPageModel,
  type DisableModuleConfirmPageModel,
  type RemoveServerConfirmPageModel,
} from './views/pages/game-servers.js';

import { escapeHtml, page } from './views/components.js';

export function loginPage(href: string): string {
  return page(
    'Owner sign in',
    `<section class="card narrow"><h1>Office Club owner panel</h1><p>Sign in with the allowlisted Discord owner account.</p><a class="button" href="${escapeHtml(href)}">Sign in with Discord</a></section>`,
  );
}
