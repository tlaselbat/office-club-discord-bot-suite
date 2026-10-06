import { adminShell, emptyState, escapeHtml, statusBadge, table } from '../components.js';

export interface GuildSummary {
  id: string;
  name: string;
  modules: Array<{
    key: string;
    label: string;
    release: string;
    releaseVariant: string;
    operational: string;
    operationalVariant: string;
    configured: boolean;
    enabled: boolean;
    version: number | null;
  }>;
}

export function guildIndex(username: string, csrf: string, guilds: GuildSummary[]): string {
  const body =
    guilds.length === 0
      ? emptyState('The bot is not a member of any guilds.')
      : table(
          ['Guild', 'Game Servers', 'Competitive', 'Rewards'],
          guilds.map((guild) => [
            `<a href="/admin/guilds/${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</a>`,
            ...guild.modules.map(
              (module) =>
                `${statusBadge(module.operational, module.operationalVariant)} <span class="badge ${escapeHtml(module.releaseVariant)}">${escapeHtml(module.release)}</span>`,
            ),
          ]),
        );
  return adminShell(
    { title: 'Guilds', username, csrf, currentPath: '/admin', currentGuildId: undefined },
    `<section class="card"><h1>Guilds</h1>${body}</section>`,
  );
}
