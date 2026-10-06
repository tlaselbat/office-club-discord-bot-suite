import type { GameServerDiagnosticsReport } from '../../../../modules/game-servers/services/game-server-diagnostics-service.js';
import {
  actionForm,
  adminShell,
  card,
  emptyState,
  escapeHtml,
  errorSummary,
  hiddenCsrf,
  input,
  notice,
  options,
  select,
  statusBadge,
  table,
} from '../components.js';

export interface GameServersPageModel {
  id: string;
  name: string;
  username: string;
  csrf: string;
  moduleEnabled: boolean;
  settingsVersion: number | null;
  /** @deprecated legacy panel fields are accepted only for page-fixture compatibility. */
  panelChannelId?: string | undefined;
  panelChannelName?: string | undefined;
  panelMessageOk?: boolean;
  textChannels: Array<{ id: string; name: string }>;
  servers: Array<{
    id: string;
    displayName: string;
    provider: string;
    providerServerId: string;
    enabled: boolean;
    public: boolean;
    hostingState: string;
    stale: boolean;
    lastSuccessfulAt: Date | null;
    consecutiveFailures: number;
    displays?: Array<{ id: string; channelName: string }>;
    /** @deprecated compatibility with existing page fixtures. */
    cardCount?: number;
    needsAttention: boolean;
    version: number;
  }>;
  filter: 'all' | 'healthy' | 'needs-attention' | 'disabled';
  cards?: Array<{
    id: string;
    gameServerId: string;
    serverName: string;
    channelId: string;
    channelName: string;
    messageId: string | null;
    state: string;
    lastReconciledAt: Date | null;
    lastError: string | null;
  }>;
  diagnostics?: GameServerDiagnosticsReport;
  availableServers: Array<{ id: string; name: string; location: string | null }>;
  notice?: string;
  errors?: string[];
}

export function gameServersPage(model: GameServersPageModel): string {
  const cards = model.cards ?? [];
  const noticeHtml = model.notice === undefined ? '' : notice(model.notice, 'success');
  const errorBlock = errorSummary(model.errors ?? []);
  const issues =
    model.servers.filter((server) => server.needsAttention).length +
    cards.filter((card) => card.state !== 'HEALTHY').length;
  const moduleCard = `<p>Release: ${statusBadge('Production ready', 'production-ready')} · ${statusBadge(model.moduleEnabled ? 'Enabled' : 'Disabled', model.moduleEnabled ? 'enabled' : 'disabled')} · ${String(model.servers.length)} registered · ${String(cards.length)} displays · ${String(issues)} issues</p><p class="actions">${model.moduleEnabled ? `<a class="button" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/disable-confirm">Disable module</a>` : actionForm(`/admin/guilds/${escapeHtml(model.id)}/game-servers/enable`, model.csrf, `<input type="hidden" name="version" value="${String(model.settingsVersion ?? 0)}"><button type="submit">Enable module</button>`)}</p>`;
  const serverTable = serverListCard(model);
  const addBody =
    model.availableServers.length === 0
      ? emptyState('No unregistered DatHost CS2 servers are available.')
      : addServerForm(model);
  const diagnosticsBody =
    model.diagnostics === undefined
      ? emptyState('Run diagnostics to see the current report.')
      : diagnosticsCard(model.diagnostics);
  return adminShell(
    {
      title: `${model.name} · Game Servers`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.id}/game-servers`,
      currentGuildId: model.id,
    },
    `${noticeHtml}${errorBlock}` +
      card('Game Servers', moduleCard) +
      serverTable +
      displaysCard(model) +
      card('Register server', addBody) +
      card(
        'Diagnostics & maintenance',
        `<form method="post" action="/admin/guilds/${escapeHtml(model.id)}/game-servers/diagnostics">${hiddenCsrf(model.csrf)}<button type="submit">Run diagnostics</button></form>${diagnosticsBody}`,
      ),
  );
}

function addServerForm(model: GameServersPageModel): string {
  return actionForm(
    `/admin/guilds/${escapeHtml(model.id)}/game-servers/add`,
    model.csrf,
    `<label for="displayName">Display name<input id="displayName" name="displayName" maxlength="64" required></label><label for="providerServerId">DatHost server<select id="providerServerId" name="providerServerId" required>${options(
      model.availableServers.map((server) => ({
        id: server.id,
        name: `${server.name}${server.location === null ? '' : ` (${server.location})`}`,
      })),
      '',
    )}</select></label><button type="submit">Register server</button>`,
  );
}

function serverListCard(model: GameServersPageModel): string {
  const filtered = model.servers.filter((server) => {
    if (model.filter === 'healthy') return !server.needsAttention && server.enabled;
    if (model.filter === 'needs-attention') return server.needsAttention;
    if (model.filter === 'disabled') return !server.enabled;
    return true;
  });
  const filterLinks = ['all', 'healthy', 'needs-attention', 'disabled'].map(
    (filter) =>
      `<a href="?filter=${filter}"${model.filter === filter ? ' aria-current="true"' : ''}>${escapeHtml(filter.replace(/-/g, ' '))}</a>`,
  );
  if (filtered.length === 0) {
    return card(
      'Registered servers',
      `<p class="filter-nav">${filterLinks.join(' · ')}</p>${emptyState('No servers match this filter.')}`,
    );
  }
  const rows = filtered.map((server) => {
    const status = server.needsAttention
      ? statusBadge('Needs attention', 'needs-attention')
      : statusBadge('Healthy', 'enabled');
    const versionField = `<input type="hidden" name="version" value="${String(server.version)}">`;
    const actions = `<div class="actions">${actionForm(`/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/toggle-enabled`, model.csrf, `${versionField}<button type="submit">${server.enabled ? 'Disable polling' : 'Enable polling'}</button>`, 'post')}${actionForm(`/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/toggle-public`, model.csrf, `${versionField}<button type="submit">Make ${server.public ? 'private' : 'public'}</button>`, 'post')}<a class="button" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/edit">Edit</a><a class="button" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/remove-confirm">Remove</a></div>`;
    return [
      escapeHtml(server.displayName),
      escapeHtml(server.provider),
      statusBadge(server.enabled ? 'Enabled' : 'Disabled', server.enabled ? 'enabled' : 'disabled'),
      statusBadge(server.public ? 'Public' : 'Private', server.public ? 'enabled' : 'disabled'),
      escapeHtml(server.hostingState),
      server.lastSuccessfulAt === null
        ? 'Never'
        : escapeHtml(server.lastSuccessfulAt.toISOString()),
      String(server.consecutiveFailures),
      (server.displays ?? []).length === 0
        ? 'None'
        : (server.displays ?? [])
            .map((display) => `#${escapeHtml(display.channelName)}`)
            .join(', '),
      `${status}${actions}`,
    ];
  });
  return card(
    'Registered servers',
    `<p class="filter-nav">${filterLinks.join(' · ')}</p>${table(
      [
        'Name',
        'Provider',
        'Polling',
        'Visibility',
        'State',
        'Last success',
        'Failures',
        'Displays',
        'Status / Actions',
      ],
      rows,
    )}`,
  );
}

function displaysCard(model: GameServersPageModel): string {
  const publish =
    model.servers.length === 0 || model.textChannels.length === 0
      ? emptyState('Register a server and make a text channel available to publish a display.')
      : actionForm(
          `/admin/guilds/${escapeHtml(model.id)}/game-servers/displays`,
          model.csrf,
          `${select(
            'Registered server',
            'gameServerId',
            model.servers.map((server) => ({ id: server.id, name: server.displayName })),
            '',
            'required',
          )}${select('Discord text channel', 'channelId', model.textChannels, '', 'required')}<button type="submit">Publish server card</button>`,
        );
  const rows = (model.cards ?? []).map((card) => {
    const link =
      card.messageId === null
        ? 'Not created'
        : `<a href="https://discord.com/channels/${escapeHtml(model.id)}/${escapeHtml(card.channelId)}/${escapeHtml(card.messageId)}">Open in Discord</a>`;
    const base = `/admin/guilds/${escapeHtml(model.id)}/game-servers/displays/${escapeHtml(card.id)}`;
    const fields = `<input type="hidden" name="gameServerId" value="${escapeHtml(card.gameServerId)}">`;
    return [
      escapeHtml(card.serverName),
      `#${escapeHtml(card.channelName)}`,
      link,
      statusBadge(card.state, card.state === 'HEALTHY' ? 'enabled' : 'needs-attention'),
      card.lastReconciledAt === null ? 'Never' : escapeHtml(card.lastReconciledAt.toISOString()),
      `<div class="actions">${actionForm(`${base}/reconcile`, model.csrf, `${fields}<button type="submit">Refresh / Repair</button>`)}${actionForm(`${base}/move`, model.csrf, `${select('Move to channel', 'channelId', model.textChannels, '', 'required')}<button type="submit">Move</button>`)}${actionForm(`${base}/remove`, model.csrf, `${fields}<button type="submit">Remove from channel</button>`)}</div>${card.lastError === null ? '' : `<p class="hint">${escapeHtml(card.lastError)}</p>`}`,
    ];
  });
  return card(
    'Discord displays',
    `${publish}${rows.length === 0 ? emptyState('No Discord displays are published.') : table(['Server', 'Channel', 'Message', 'State', 'Last reconciled', 'Actions'], rows)}`,
  );
}

function diagnosticsCard(report: GameServerDiagnosticsReport): string {
  const aggregate = report.aggregate
    .map(
      (check) =>
        `<li class="${check.ok ? 'ok' : 'bad'}">${escapeHtml(check.label)}: ${check.ok ? 'OK' : escapeHtml(check.detail ?? 'failed')}</li>`,
    )
    .join('');
  const servers = report.servers
    .map(
      (server) =>
        `<details><summary>${escapeHtml(server.displayName)}</summary><ul>${server.checks.map((check) => `<li class="${check.ok ? 'ok' : 'bad'}">${escapeHtml(check.label)}: ${check.ok ? 'OK' : escapeHtml(check.detail ?? 'failed')}</li>`).join('')}</ul></details>`,
    )
    .join('');
  return `<p class="hint">Run at ${escapeHtml(report.runAt.toISOString())} (${report.mode})</p><ul>${aggregate}</ul>${servers}`;
}

export interface GameServerEditPageModel {
  guildId: string;
  guildName: string;
  username: string;
  csrf: string;
  server: {
    id: string;
    displayName: string;
    description: string | null;
    enabled: boolean;
    public: boolean;
    connectDomain: string | null;
    joinUrl: string | null;
    imageUrl: string | null;
    sortOrder: number;
    provider: string;
    providerServerId: string;
    version: number;
  };
  snapshot?:
    | {
        hostingState: string;
        gameplayState: string;
        hostname: string | null;
        rawIp: string | null;
        port: number | null;
        map: string | null;
        players: number | null;
        maxPlayers: number | null;
        datacenter: string | null;
        cpuPercent: number | null;
        memoryUsageMb: number | null;
        averagePingMs: number | null;
        packetLossPercent: number | null;
        serverVarMs: number | null;
        observedAt: Date;
        lastSuccessfulAt: Date | null;
        lastOnlineAt: Date | null;
        consecutiveFailures: number;
        stale: boolean;
        lastError: string | null;
      }
    | undefined;
  textChannels: Array<{ id: string; name: string }>;
  cards: Array<{
    id: string;
    channelId: string;
    channelName: string;
    messageId: string | null;
    state: string;
    lastReconciledAt: Date | null;
    lastError: string | null;
  }>;
  notice?: string | undefined;
  errors?: string[] | undefined;
  fieldErrors?: Record<string, string[]> | undefined;
}

export function gameServerEditPage(model: GameServerEditPageModel): string {
  const noticeHtml = model.notice === undefined ? '' : notice(model.notice, 'success');
  const errorBlock = errorSummary(model.errors ?? []);
  const snapshot = model.snapshot;
  const readOnly = `<div class="read-only"><p>These values are read-only and reflect the latest observed state.</p>${snapshot === undefined ? emptyState('No observation has been recorded.') : `<dl class="dl"><dt>Hosting state</dt><dd>${escapeHtml(snapshot.hostingState)}</dd><dt>Gameplay state</dt><dd>${escapeHtml(snapshot.gameplayState)}</dd><dt>Hostname</dt><dd>${escapeHtml(snapshot.hostname ?? 'Unknown')}</dd><dt>Address</dt><dd>${escapeHtml(snapshot.rawIp ?? 'Unknown')}${snapshot.port === null ? '' : `:${String(snapshot.port)}`}</dd><dt>Data center</dt><dd>${escapeHtml(snapshot.datacenter ?? 'Unknown')}</dd><dt>Map</dt><dd>${escapeHtml(snapshot.map ?? 'Unknown')}</dd><dt>Players</dt><dd>${snapshot.players === null ? 'Unknown' : `${String(snapshot.players)}${snapshot.maxPlayers === null ? '' : ` / ${String(snapshot.maxPlayers)}`}`}</dd><dt>CPU</dt><dd>${snapshot.cpuPercent === null ? 'Unknown' : `${String(snapshot.cpuPercent)}%`}</dd><dt>Memory</dt><dd>${snapshot.memoryUsageMb === null ? 'Unknown' : `${String(snapshot.memoryUsageMb)} MB`}</dd><dt>Average ping</dt><dd>${snapshot.averagePingMs === null ? 'Unknown' : `${String(snapshot.averagePingMs)} ms`}</dd><dt>Packet loss</dt><dd>${snapshot.packetLossPercent === null ? 'Unknown' : `${String(snapshot.packetLossPercent)}%`}</dd><dt>Server var</dt><dd>${snapshot.serverVarMs === null ? 'Unknown' : `${String(snapshot.serverVarMs)} ms`}</dd><dt>Last successful</dt><dd>${snapshot.lastSuccessfulAt === null ? 'Never' : escapeHtml(snapshot.lastSuccessfulAt.toISOString())}</dd><dt>Last online</dt><dd>${snapshot.lastOnlineAt === null ? 'Never' : escapeHtml(snapshot.lastOnlineAt.toISOString())}</dd><dt>Failures</dt><dd>${String(snapshot.consecutiveFailures)}</dd><dt>Stale</dt><dd>${snapshot.stale ? 'Yes' : 'No'}</dd><dt>Observed at</dt><dd>${escapeHtml(snapshot.observedAt.toISOString())}</dd>${snapshot.lastError === null ? '' : `<dt>Recent error</dt><dd>${escapeHtml(snapshot.lastError)}</dd>`}</dl>`}</div>`;
  const cardInfo =
    model.cards.length === 0
      ? emptyState('No Discord displays are published for this server.')
      : model.cards
          .map((card) => {
            const base = `/admin/guilds/${escapeHtml(model.guildId)}/game-servers/displays/${escapeHtml(card.id)}`;
            const message =
              card.messageId === null
                ? 'Not created'
                : `<a href="https://discord.com/channels/${escapeHtml(model.guildId)}/${escapeHtml(card.channelId)}/${escapeHtml(card.messageId)}">Open in Discord</a>`;
            return `<details><summary>#${escapeHtml(card.channelName)} · ${statusBadge(card.state, card.state === 'HEALTHY' ? 'enabled' : 'needs-attention')}</summary><p>${message}</p><p>Last reconciled: ${card.lastReconciledAt === null ? 'Never' : escapeHtml(card.lastReconciledAt.toISOString())}</p>${card.lastError === null ? '' : `<p class="hint">${escapeHtml(card.lastError)}</p>`}<div class="actions">${actionForm(`${base}/reconcile`, model.csrf, `<input type="hidden" name="gameServerId" value="${escapeHtml(model.server.id)}"><button type="submit">Refresh / Repair</button>`)}${actionForm(`${base}/move`, model.csrf, `${select('Move to channel', 'channelId', model.textChannels, '', 'required')}<button type="submit">Move</button>`)}${actionForm(`${base}/remove`, model.csrf, `<input type="hidden" name="gameServerId" value="${escapeHtml(model.server.id)}"><button type="submit">Remove</button>`)}</div></details>`;
          })
          .join('');
  const form = actionForm(
    `/admin/guilds/${escapeHtml(model.guildId)}/game-servers/${escapeHtml(model.server.id)}/edit`,
    model.csrf,
    `<input type="hidden" name="version" value="${String(model.server.version)}">
${input('Display name', 'displayName', model.server.displayName, 'text', 'maxlength="64" required', model.fieldErrors?.displayName)}
${input('Description', 'description', model.server.description ?? '', 'text', 'maxlength="500"', model.fieldErrors?.description)}
<label class="checkbox"><input type="checkbox" name="enabled" value="1"${model.server.enabled ? ' checked' : ''}> Enable polling</label>
<label class="checkbox"><input type="checkbox" name="public" value="1"${model.server.public ? ' checked' : ''}> Public visibility</label>
${input('Connect domain', 'connectDomain', model.server.connectDomain ?? '', 'text', 'maxlength="256" placeholder="e.g. arena.example.com"', model.fieldErrors?.connectDomain)}
${input('HTTPS join URL', 'joinUrl', model.server.joinUrl ?? '', 'url', 'maxlength="500" placeholder="https://..."', model.fieldErrors?.joinUrl)}
${input('Image URL', 'imageUrl', model.server.imageUrl ?? '', 'url', 'maxlength="500" placeholder="https://..."', model.fieldErrors?.imageUrl)}
${input('Sort order', 'sortOrder', model.server.sortOrder, 'number', 'min="0"', model.fieldErrors?.sortOrder)}
<div class="notice warning">This webpanel changes only the bot's local registration. It does not mutate the DatHost server.</div>
<button type="submit">Save server</button>`,
  );
  return adminShell(
    {
      title: `${model.guildName} · Edit ${model.server.displayName}`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.guildId}/game-servers`,
      currentGuildId: model.guildId,
    },
    `<p><a href="/admin/guilds/${escapeHtml(model.guildId)}/game-servers">← Game Servers</a></p>${noticeHtml}${errorBlock}` +
      card('Server details', form) +
      card('Live state', readOnly) +
      card('Discord displays', cardInfo),
  );
}

export interface DisableModuleConfirmPageModel {
  id: string;
  name: string;
  username: string;
  csrf: string;
  version: number | null;
}

export function disableModuleConfirmPage(model: DisableModuleConfirmPageModel): string {
  const body = actionForm(
    `/admin/guilds/${escapeHtml(model.id)}/game-servers/disable`,
    model.csrf,
    `<input type="hidden" name="version" value="${String(model.version ?? 0)}">
<p>Disabling Game Servers stops panel reconciliation and publication work. Local configuration and server registrations are preserved.</p>
<div class="actions"><button type="submit">Disable Game Servers</button><a class="button" href="/admin/guilds/${escapeHtml(model.id)}/game-servers">Cancel</a></div>`,
  );
  return adminShell(
    {
      title: `${model.name} · Disable Game Servers`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.id}/game-servers`,
      currentGuildId: model.id,
    },
    card('Confirm disable', body),
  );
}

export interface RemoveServerConfirmPageModel {
  guildId: string;
  guildName: string;
  username: string;
  csrf: string;
  server: { id: string; displayName: string };
}

export function removeServerConfirmPage(model: RemoveServerConfirmPageModel): string {
  const body = actionForm(
    `/admin/guilds/${escapeHtml(model.guildId)}/game-servers/${escapeHtml(model.server.id)}/remove`,
    model.csrf,
    `<p>Remove the local registration for <strong>${escapeHtml(model.server.displayName)}</strong>. The DatHost server will not be modified.</p>
<div class="actions"><button type="submit">Remove registration</button><a class="button" href="/admin/guilds/${escapeHtml(model.guildId)}/game-servers">Cancel</a></div>`,
  );
  return adminShell(
    {
      title: `${model.guildName} · Remove server`,
      username: model.username,
      csrf: model.csrf,
      currentPath: `/admin/guilds/${model.guildId}/game-servers`,
      currentGuildId: model.guildId,
    },
    card('Confirm removal', body),
  );
}
