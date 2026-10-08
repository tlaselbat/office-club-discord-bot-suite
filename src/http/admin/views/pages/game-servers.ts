import type { GameServerDiagnosticsReport } from '../../../../modules/game-servers/services/game-server-diagnostics-service.js';
import {
  actionForm,
  adminShell,
  card,
  emptyState,
  escapeHtml,
  errorSummary,
  fieldErrors,
  hiddenCsrf,
  input,
  notice,
  options,
  select,
  statusBadge,
  table,
} from '../components.js';
import { formatTimestamp } from '../time.js';
import {
  DEFAULT_CARD_DESCRIPTION,
  normalizeCardProfile,
  resolveCardProfile,
} from '../../../../modules/game-servers/card-profile.js';

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
  const moduleCard = `<p>Release: ${statusBadge('Production ready', 'production-ready')} · ${statusBadge(model.moduleEnabled ? 'Enabled' : 'Disabled', model.moduleEnabled ? 'enabled' : 'disabled')} · ${String(model.servers.length)} registered · ${String(cards.length)} displays · ${String(issues)} issues</p><div class="actions">${model.moduleEnabled ? `<a class="button danger" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/disable-confirm">Disable module</a>` : actionForm(`/admin/guilds/${escapeHtml(model.id)}/game-servers/enable`, model.csrf, `<input type="hidden" name="version" value="${String(model.settingsVersion ?? 0)}"><button type="submit">Enable module</button>`)}</div>`;
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
      card('Module status', moduleCard) +
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
    `<label for="displayName">Display name<input id="displayName" name="displayName" maxlength="64" required></label><label for="providerServerId">DatHost server<select id="providerServerId" name="providerServerId" aria-describedby="providerServerId-selected-value" required>${options(
      model.availableServers.map((server) => ({
        id: server.id,
        name: `${server.name}${server.location === null ? '' : ` (${server.location})`}`,
      })),
      '',
    )}</select></label>${selectedValueHint(
      'providerServerId-selected-value',
      model.availableServers.map((server) => ({
        id: server.id,
        name: `${server.name}${server.location === null ? '' : ` (${server.location})`}`,
      })),
      '',
    )}<button type="submit">Register server</button>`,
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
      `<nav class="filter-nav" aria-label="Filter registered servers">${filterLinks.join('')}</nav>${emptyState('No servers match this filter.')}`,
    );
  }
  const serverCards = filtered.map((server) => {
    const status = server.needsAttention
      ? statusBadge('Needs attention', 'needs-attention')
      : statusBadge('Healthy', 'enabled');
    const versionField = `<input type="hidden" name="version" value="${String(server.version)}">`;
    const actions = `<div class="actions">${actionForm(`/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/toggle-enabled`, model.csrf, `${versionField}<button class="secondary" type="submit">${server.enabled ? 'Disable polling' : 'Enable polling'}</button>`, 'post')}${actionForm(`/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/toggle-public`, model.csrf, `${versionField}<button class="secondary" type="submit">Make ${server.public ? 'private' : 'public'}</button>`, 'post')}<a class="button secondary" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/edit">Edit</a><a class="button secondary" href="/admin/guilds/${escapeHtml(model.id)}/game-servers/${escapeHtml(server.id)}/remove-confirm">Remove</a></div>`;
    const displays =
      (server.displays ?? []).length === 0
        ? 'None'
        : (server.displays ?? [])
            .map((display) => `#${escapeHtml(display.channelName)}`)
            .join(', ');
    return `<article class="server-card"><header class="server-card-header"><div class="server-card-title"><p class="server-card-eyebrow">Registered server</p><h3>${escapeHtml(server.displayName)}</h3></div>${status}</header><div class="server-card-badges">${statusBadge(server.enabled ? 'Polling enabled' : 'Polling disabled', server.enabled ? 'enabled' : 'disabled')}${statusBadge(server.public ? 'Public' : 'Private', server.public ? 'enabled' : 'disabled')}</div><dl class="server-card-details"><div><dt>Provider</dt><dd>${escapeHtml(server.provider)}</dd></div><div><dt>State</dt><dd>${escapeHtml(server.hostingState)}</dd></div><div><dt>Last success</dt><dd>${server.lastSuccessfulAt === null ? 'Never' : formatTimestamp(server.lastSuccessfulAt)}</dd></div><div><dt>Failures</dt><dd>${String(server.consecutiveFailures)}</dd></div><div class="server-card-displays"><dt>Displays</dt><dd>${displays}</dd></div></dl><div class="server-card-actions"><p>Server controls</p>${actions}</div></article>`;
  });
  return card(
    'Registered servers',
    `<nav class="filter-nav" aria-label="Filter registered servers">${filterLinks.join('')}</nav><div class="server-grid">${serverCards.join('')}</div>`,
  );
}

function displaysCard(model: GameServersPageModel): string {
  const publish =
    model.servers.length === 0 || model.textChannels.length === 0
      ? emptyState('Register a server and make a text channel available to publish a display.')
      : actionForm(
          `/admin/guilds/${escapeHtml(model.id)}/game-servers/displays`,
          model.csrf,
          `${selectedValueSelect(
            'Registered server',
            'gameServerId',
            model.servers.map((server) => ({ id: server.id, name: server.displayName })),
            '',
            'required',
          )}${selectedValueSelect('Discord text channel', 'channelId', model.textChannels, '', 'required')}<button type="submit">Publish server card</button>`,
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
      card.lastReconciledAt === null ? 'Never' : formatTimestamp(card.lastReconciledAt),
      `<div class="actions">${actionForm(`${base}/reconcile`, model.csrf, `${fields}<button class="secondary" type="submit">Refresh / Repair</button>`)}${actionForm(`${base}/move`, model.csrf, `${selectedValueSelect('Move to channel', 'channelId', model.textChannels, '', 'required', `display-${card.id}-channelId`)}<button class="secondary" type="submit">Move</button>`)}${actionForm(`${base}/remove`, model.csrf, `${fields}<button class="danger" type="submit">Remove from channel</button>`)}</div>${card.lastError === null ? '' : `<p class="hint">${escapeHtml(card.lastError)}</p>`}`,
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
  return `<p class="hint">Run at ${formatTimestamp(report.runAt)} (${report.mode})</p><ul>${aggregate}</ul>${servers}`;
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
    cardProfile?: unknown;
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
  submitted?: Record<string, unknown> | undefined;
}

export function gameServerEditPage(model: GameServerEditPageModel): string {
  const profile = normalizeCardProfile(model.server.cardProfile);
  const effective = resolveCardProfile(model.server.cardProfile);
  const value = (name: string, saved: string | number | null): string =>
    typeof model.submitted?.[name] === 'string' ? model.submitted[name] : String(saved ?? '');
  const checked = (name: 'enabled' | 'public'): boolean =>
    model.submitted === undefined ? model.server[name] : model.submitted[name] === '1';
  const noticeHtml = model.notice === undefined ? '' : notice(model.notice, 'success');
  const errorBlock = errorSummary(model.errors ?? []);
  const snapshot = model.snapshot;
  const readOnly = `<div class="read-only"><p>These values are read-only and reflect the latest observed state.</p>${snapshot === undefined ? emptyState('No observation has been recorded.') : `<dl class="dl"><dt>Hosting state</dt><dd>${escapeHtml(snapshot.hostingState)}</dd><dt>Gameplay state</dt><dd>${escapeHtml(snapshot.gameplayState)}</dd><dt>Hostname</dt><dd>${escapeHtml(snapshot.hostname ?? 'Unknown')}</dd><dt>Address</dt><dd>${escapeHtml(snapshot.rawIp ?? 'Unknown')}${snapshot.port === null ? '' : `:${String(snapshot.port)}`}</dd><dt>Data center</dt><dd>${escapeHtml(snapshot.datacenter ?? 'Unknown')}</dd><dt>Map</dt><dd>${escapeHtml(snapshot.map ?? 'Unknown')}</dd><dt>Players</dt><dd>${snapshot.players === null ? 'Unknown' : `${String(snapshot.players)}${snapshot.maxPlayers === null ? '' : ` / ${String(snapshot.maxPlayers)}`}`}</dd><dt>CPU</dt><dd>${snapshot.cpuPercent === null ? 'Unknown' : `${String(snapshot.cpuPercent)}%`}</dd><dt>Memory</dt><dd>${snapshot.memoryUsageMb === null ? 'Unknown' : `${String(snapshot.memoryUsageMb)} MB`}</dd><dt>Average ping</dt><dd>${snapshot.averagePingMs === null ? 'Unknown' : `${String(snapshot.averagePingMs)} ms`}</dd><dt>Packet loss</dt><dd>${snapshot.packetLossPercent === null ? 'Unknown' : `${String(snapshot.packetLossPercent)}%`}</dd><dt>Server var</dt><dd>${snapshot.serverVarMs === null ? 'Unknown' : `${String(snapshot.serverVarMs)} ms`}</dd><dt>Last successful</dt><dd>${snapshot.lastSuccessfulAt === null ? 'Never' : formatTimestamp(snapshot.lastSuccessfulAt)}</dd><dt>Last online</dt><dd>${snapshot.lastOnlineAt === null ? 'Never' : formatTimestamp(snapshot.lastOnlineAt)}</dd><dt>Failures</dt><dd>${String(snapshot.consecutiveFailures)}</dd><dt>Stale</dt><dd>${snapshot.stale ? 'Yes' : 'No'}</dd><dt>Observed at</dt><dd>${formatTimestamp(snapshot.observedAt)}</dd>${snapshot.lastError === null ? '' : `<dt>Recent error</dt><dd>${escapeHtml(snapshot.lastError)}</dd>`}</dl>`}</div>`;
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
            return `<details><summary>#${escapeHtml(card.channelName)} · ${statusBadge(card.state, card.state === 'HEALTHY' ? 'enabled' : 'needs-attention')}</summary><p>${message}</p><p>Last reconciled: ${card.lastReconciledAt === null ? 'Never' : formatTimestamp(card.lastReconciledAt)}</p>${card.lastError === null ? '' : `<p class="hint">${escapeHtml(card.lastError)}</p>`}<div class="actions">${actionForm(`${base}/reconcile`, model.csrf, `<input type="hidden" name="gameServerId" value="${escapeHtml(model.server.id)}"><button class="secondary" type="submit">Refresh / Repair</button>`)}${actionForm(`${base}/move`, model.csrf, `${selectedValueSelect('Move to channel', 'channelId', model.textChannels, '', 'required', `display-${card.id}-channelId`)}<button class="secondary" type="submit">Move</button>`)}${actionForm(`${base}/remove`, model.csrf, `<input type="hidden" name="gameServerId" value="${escapeHtml(model.server.id)}"><button class="danger" type="submit">Remove</button>`)}</div></details>`;
          })
          .join('');
  const form = actionForm(
    `/admin/guilds/${escapeHtml(model.guildId)}/game-servers/${escapeHtml(model.server.id)}/edit`,
    model.csrf,
    `<input type="hidden" name="version" value="${escapeHtml(value('version', model.server.version))}">
${model.submitted === undefined ? '' : notice('These are unsaved edits. Saved values are shown below. Reload before retrying a configuration conflict.', 'warning')}
<fieldset class="game-server-config-group"><legend>Registration and monitoring</legend>
<label class="checkbox"><input type="checkbox" name="enabled" value="1"${checked('enabled') ? ' checked' : ''}> Enable polling</label>
<p class="hint">Disabling polling preserves existing displays and their last observation.</p>
<label class="checkbox"><input type="checkbox" name="public" value="1"${checked('public') ? ' checked' : ''}> Public visibility</label>
<p class="hint">Making a server private removes its Discord displays. Registration remains saved.</p>
${input('Sort order', 'sortOrder', value('sortOrder', model.server.sortOrder), 'number', 'min="0"', model.fieldErrors?.sortOrder)}
</fieldset><fieldset class="game-server-config-group"><legend>Card Profile</legend>
${input('Display name', 'displayName', value('displayName', model.server.displayName), 'text', 'maxlength="64" required', model.fieldErrors?.displayName)}
${textarea('Description', 'description', value('description', model.server.description), 'maxlength="500"', model.fieldErrors?.description)}
<p class="hint">Blank description uses: ${escapeHtml(DEFAULT_CARD_DESCRIPTION)}</p>
${input('Accent color', 'accentColor', value('accentColor', profile.accentColor), 'text', 'pattern="#[0-9a-fA-F]{6}" maxlength="7" required', model.fieldErrors?.accentColor)}
${input('Thumbnail HTTPS URL', 'thumbnailImageUrl', value('thumbnailImageUrl', profile.thumbnailImageUrl), 'url', 'maxlength="500"', model.fieldErrors?.thumbnailImageUrl)}
<p class="hint">Blank thumbnail uses the default server icon.</p>
${input('Map artwork fallback HTTPS URL', 'imageUrl', value('imageUrl', model.server.imageUrl), 'url', 'maxlength="500" placeholder="https://..."', model.fieldErrors?.imageUrl)}
<p class="hint">Known local map artwork takes priority; this URL is used when map artwork is unavailable.</p>
${(['online', 'offline', 'warning', 'pending'] as const)
  .map((state) => {
    const name = `${state}EmojiId` as const;
    return input(
      `${state.charAt(0).toUpperCase()}${state.slice(1)} status emoji ID`,
      name,
      value(name, profile[name]),
      'text',
      'inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20"',
      model.fieldErrors?.[name],
    );
  })
  .join('')}
<p class="hint">Blank emoji IDs inherit the deployment default. Missing or invalid IDs use a plain dot; custom emojis must be available to the bot.</p>
${input('Connect domain', 'connectDomain', value('connectDomain', model.server.connectDomain), 'text', 'maxlength="256" placeholder="e.g. arena.example.com"', model.fieldErrors?.connectDomain)}
${input('HTTPS join URL', 'joinUrl', value('joinUrl', model.server.joinUrl), 'url', 'maxlength="500" placeholder="https://..."', model.fieldErrors?.joinUrl)}
<p class="hint">The join URL appears in the server detail response. The card Connect button provides the server address.</p>
</fieldset>
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
    `<p><a class="button secondary" href="/admin/guilds/${escapeHtml(model.guildId)}/game-servers">← Game Servers</a></p>${noticeHtml}${errorBlock}` +
      card('Server configuration', form) +
      card(
        'Saved Card Profile',
        `<p>These values reflect saved configuration, before any unsaved edits above.</p><dl class="dl"><dt>Name</dt><dd>${escapeHtml(model.server.displayName)}</dd><dt>Description</dt><dd>${escapeHtml(model.server.description?.trim() || DEFAULT_CARD_DESCRIPTION)}</dd><dt>Accent</dt><dd>${escapeHtml(profile.accentColor)}</dd><dt>Thumbnail</dt><dd>${escapeHtml(effective.thumbnailImageUrl)}</dd>${(['online', 'offline', 'warning', 'pending'] as const).map((state) => `<dt>${state} emoji</dt><dd>${escapeHtml(effective[`${state}EmojiId`] ?? 'Plain dot')}</dd>`).join('')}</dl>`,
      ) +
      card('Live state', readOnly) +
      card('Discord displays', cardInfo),
  );
}

function selectedValueSelect(
  label: string,
  name: string,
  items: Array<{ id: string; name: string }>,
  selected: string | string[],
  attributes: string,
  id = name,
): string {
  const hintId = `${id}-selected-value`;
  return `${select(label, name, items, selected, `${attributes} aria-describedby="${hintId}"`, undefined, undefined, id)}${selectedValueHint(hintId, items, selected)}`;
}

function selectedValueHint(
  hintId: string,
  items: Array<{ id: string; name: string }>,
  selected: string | string[],
): string {
  const values = (Array.isArray(selected) ? selected : [selected]).filter((id) => id !== '');
  const names = (values.length === 0 ? items.slice(0, 1).map((item) => item.id) : values)
    .map((id) => items.find((item) => item.id === id)?.name ?? id)
    .map((name) => escapeHtml(name));
  return `<p class="hint selected-value" id="${escapeHtml(hintId)}" aria-live="polite">${names.length === 0 ? 'No options available.' : `Selected: ${names.join(', ')}`}</p>`;
}

function textarea(
  label: string,
  name: string,
  value: string,
  attributes: string,
  errors?: string[],
): string {
  const errorHtml = fieldErrors(name, errors);
  const errorAttributes =
    errors === undefined || errors.length === 0
      ? ''
      : ` aria-describedby="${escapeHtml(name)}-error" aria-invalid="true"`;
  return `<label for="${escapeHtml(name)}">${escapeHtml(label)}${errorHtml}<textarea id="${escapeHtml(name)}" name="${escapeHtml(name)}" rows="4"${errorAttributes} ${attributes}>${escapeHtml(value)}</textarea></label>`;
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
<div class="actions"><button class="danger" type="submit">Disable Game Servers</button><a class="button secondary" href="/admin/guilds/${escapeHtml(model.id)}/game-servers">Cancel</a></div>`,
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
<div class="actions"><button class="danger" type="submit">Remove registration</button><a class="button secondary" href="/admin/guilds/${escapeHtml(model.guildId)}/game-servers">Cancel</a></div>`,
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
