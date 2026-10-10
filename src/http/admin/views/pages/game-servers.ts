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
import {
  cardPlaceholderValues,
  resolveMapImageUrl,
  type UpdateThreadView,
} from '../../../../modules/game-servers/renderer.js';
import { formatTimestamp } from '../time.js';
import {
  CARD_PLACEHOLDERS,
  CARD_LINE_IDS,
  CARD_LINE_STYLES,
  DEFAULT_CARD_LINE_STYLES,
  resolveCardLines,
  resolveCardLayout,
  type CardLine,
  DEFAULT_CARD_DESCRIPTION,
  DEFAULT_CARD_TEMPLATES,
  DEFAULT_STATUS_LABELS,
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
          )}${selectedValueSelect('Discord text channel', 'channelId', model.textChannels, '', 'required', 'channelId', 'Choose a channel…')}<button type="submit">Publish server card</button>`,
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
  updateThreads?: UpdateThreadView[];
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
  const inherited = resolveCardProfile(undefined);
  const savedTemplatesExist =
    model.server.cardProfile !== null &&
    typeof model.server.cardProfile === 'object' &&
    Object.hasOwn(model.server.cardProfile, 'templates');
  const savedDescription = savedTemplatesExist
    ? profile.templates.description
    : model.server.description?.trim() || DEFAULT_CARD_DESCRIPTION;
  const value = (name: string, saved: string | number | null): string =>
    typeof model.submitted?.[name] === 'string' ? model.submitted[name] : String(saved ?? '');
  const checked = (name: 'enabled' | 'public'): boolean =>
    model.submitted === undefined ? model.server[name] : model.submitted[name] === '1';
  const buttonChecked = (key: 'connect' | 'mapRules'): boolean =>
    model.submitted === undefined
      ? profile.buttons[key]
      : model.submitted[key === 'connect' ? 'showConnectButton' : 'showMapRulesButton'] === '1';
  const savedLines = resolveCardLines(model.server.cardProfile, model.server.description);
  const savedLayout = resolveCardLayout(model.server.cardProfile, model.server.description);
  const legacyUpdatesWarning = savedLayout.some((element) => element.type === 'updates')
    ? '<div class="notice warning">This saved Community Updates layout exceeds the automatic migration size. Its settings are preserved in compatibility mode. Reduce the number of card elements, then save to convert it to independent text rows.</div>'
    : '';
  const layoutJsonValue =
    typeof model.submitted?.layoutJson === 'string'
      ? model.submitted.layoutJson
      : JSON.stringify({ version: 3, elements: savedLayout });
  const requestedOrder =
    typeof model.submitted?.lineOrder === 'string'
      ? model.submitted.lineOrder.split(',')
      : savedLines.map((line) => line.id);
  const validOrder =
    requestedOrder.length === 6 &&
    new Set(requestedOrder).size === 6 &&
    requestedOrder.every((id) => CARD_LINE_IDS.includes(id as CardLine['id']));
  const editorLines = (validOrder ? requestedOrder : savedLines.map((line) => line.id)).map(
    (id) => {
      const saved = savedLines.find((line) => line.id === id);
      if (saved === undefined) throw new Error('Invalid card line ID');
      return {
        ...saved,
        template: value(`${id}Template`, saved.template),
        style: value(`${id}Style`, saved.style),
        visible:
          model.submitted === undefined
            ? saved.visible
            : model.submitted[`show${id.charAt(0).toUpperCase()}${id.slice(1)}`] === '1',
      };
    },
  );
  const noticeHtml = model.notice === undefined ? '' : notice(model.notice, 'success');
  const errorBlock = errorSummary(model.errors ?? []);
  const snapshot = model.snapshot;
  const readOnly = `<div class="read-only"><p>These values are read-only and reflect the latest observed state.</p>${
    snapshot === undefined
      ? `<div id="diagnostics">${emptyState('No observation has been recorded.')}</div>`
      : `<div class="live-state-summary">${[
          ['Hosting', snapshot.hostingState],
          ['Gameplay', snapshot.gameplayState],
          [
            'Players',
            snapshot.players === null
              ? 'Unknown'
              : `${String(snapshot.players)} / ${String(snapshot.maxPlayers ?? '?')}`,
          ],
          ['Current map', snapshot.map ?? 'Unknown'],
          ['Location', snapshot.datacenter ?? 'Unknown'],
          [
            'Polling',
            snapshot.stale ? 'Stale' : `${String(snapshot.consecutiveFailures)} failures`,
          ],
          [
            'Last success',
            snapshot.lastSuccessfulAt === null
              ? 'Never'
              : formatTimestamp(snapshot.lastSuccessfulAt),
          ],
        ]
          .map(
            ([label, text]) =>
              `<div><span>${escapeHtml(label ?? '')}</span><strong>${escapeHtml(text ?? '')}</strong></div>`,
          )
          .join(
            '',
          )}</div><details id="diagnostics" class="card-settings-group"><summary>Technical observation details</summary><dl class="dl"><dt>Hosting state</dt><dd>${escapeHtml(snapshot.hostingState)}</dd><dt>Gameplay state</dt><dd>${escapeHtml(snapshot.gameplayState)}</dd><dt>Hostname</dt><dd>${escapeHtml(snapshot.hostname ?? 'Unknown')}</dd><dt>Address</dt><dd>${escapeHtml(snapshot.rawIp ?? 'Unknown')}${snapshot.port === null ? '' : `:${String(snapshot.port)}`}</dd><dt>Data center</dt><dd>${escapeHtml(snapshot.datacenter ?? 'Unknown')}</dd><dt>Map</dt><dd>${escapeHtml(snapshot.map ?? 'Unknown')}</dd><dt>Players</dt><dd>${snapshot.players === null ? 'Unknown' : `${String(snapshot.players)}${snapshot.maxPlayers === null ? '' : ` / ${String(snapshot.maxPlayers)}`}`}</dd><dt>CPU</dt><dd>${snapshot.cpuPercent === null ? 'Unknown' : `${String(snapshot.cpuPercent)}%`}</dd><dt>Memory</dt><dd>${snapshot.memoryUsageMb === null ? 'Unknown' : `${String(snapshot.memoryUsageMb)} MB`}</dd><dt>Average ping</dt><dd>${snapshot.averagePingMs === null ? 'Unknown' : `${String(snapshot.averagePingMs)} ms`}</dd><dt>Packet loss</dt><dd>${snapshot.packetLossPercent === null ? 'Unknown' : `${String(snapshot.packetLossPercent)}%`}</dd><dt>Server var</dt><dd>${snapshot.serverVarMs === null ? 'Unknown' : `${String(snapshot.serverVarMs)} ms`}</dd><dt>Last successful</dt><dd>${snapshot.lastSuccessfulAt === null ? 'Never' : formatTimestamp(snapshot.lastSuccessfulAt)}</dd><dt>Last online</dt><dd>${snapshot.lastOnlineAt === null ? 'Never' : formatTimestamp(snapshot.lastOnlineAt)}</dd><dt>Failures</dt><dd>${String(snapshot.consecutiveFailures)}</dd><dt>Stale</dt><dd>${snapshot.stale ? 'Yes' : 'No'}</dd><dt>Observed at</dt><dd>${formatTimestamp(snapshot.observedAt)}</dd>${snapshot.lastError === null ? '' : `<dt>Recent error</dt><dd>${escapeHtml(snapshot.lastError)}</dd>`}</dl></details>`
  }</div>`;
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
            return `<details><summary>#${escapeHtml(card.channelName)} · ${statusBadge(card.state, card.state === 'HEALTHY' ? 'enabled' : 'needs-attention')}</summary><p>${message}</p><p>Last reconciled: ${card.lastReconciledAt === null ? 'Never' : formatTimestamp(card.lastReconciledAt)}</p>${card.lastError === null ? '' : `<p class="hint">${escapeHtml(card.lastError)}</p>`}<div class="actions">${actionForm(`${base}/reconcile`, model.csrf, `<input type="hidden" name="gameServerId" value="${escapeHtml(model.server.id)}"><button class="secondary" type="submit">Refresh / Repair</button>`)}${actionForm(`${base}/move`, model.csrf, `${selectedValueSelect('Move to channel', 'channelId', model.textChannels, '', 'required', `display-${card.id}-channelId`)}<button class="secondary" type="submit">Move</button>`)}${actionForm(`${base}/remove`, model.csrf, `<input type="hidden" name="gameServerId" value="${escapeHtml(model.server.id)}"><button class="danger" type="submit" data-confirm-deployment-remove>Remove</button>`)}</div></details>`;
          })
          .join('');
  const placeholderOptions = CARD_PLACEHOLDERS.map(
    ([name, description]) =>
      `<option value="{${name}}">{${name}} — ${escapeHtml(description)}</option>`,
  ).join('');
  const currentPreviewValues = cardPlaceholderValues(
    {
      ...model.server,
      guildId: model.guildId,
      snapshot:
        model.snapshot === undefined
          ? null
          : { ...model.snapshot, host: model.snapshot.rawIp, monitoringObservedAt: null },
    },
    effective,
  );
  const styleNames = {
    large: 'Large heading',
    medium: 'Medium heading',
    small: 'Small heading',
    normal: 'Normal',
    subtext: 'Subtext',
  };
  const fallbackArtwork = resolveMapImageUrl(null, null);
  const currentArtwork = resolveMapImageUrl(model.snapshot?.map ?? null, null);
  const preview = `<aside id="card-template-preview" class="read-only game-server-preview" data-guild-id="${escapeHtml(model.guildId)}" data-current-values="${escapeHtml(JSON.stringify(currentPreviewValues))}" data-update-threads="${escapeHtml(JSON.stringify(model.updateThreads ?? []))}" data-map-image="${escapeHtml(currentArtwork)}" data-map-known="${String(currentArtwork !== fallbackArtwork)}" data-raw-map="${escapeHtml(model.snapshot?.map ?? '')}" data-fallback-image="${escapeHtml(fallbackArtwork)}" data-example-map-known="${String(resolveMapImageUrl('aim_redline_fp', null) !== fallbackArtwork)}" data-example-map-image="${escapeHtml(resolveMapImageUrl('aim_redline_fp', null))}" data-default-thumbnail="${escapeHtml(inherited.thumbnailImageUrl)}" ${(['online', 'offline', 'warning', 'pending'] as const).map((state) => `data-${state}-emoji="${escapeHtml(inherited[`${state}EmojiId`] === null ? '' : `<:${state}_dot:${String(inherited[`${state}EmojiId`])}>`)}"`).join(' ')} data-raw-host="${escapeHtml(model.snapshot?.rawIp ?? '')}" data-hosting-state="${escapeHtml(model.snapshot?.hostingState ?? 'PENDING')}" data-gameplay-state="${escapeHtml(model.snapshot?.gameplayState ?? '')}" data-stale="${model.snapshot?.stale ? 'true' : 'false'}"><div class="preview-heading"><h2>Discord Preview</h2><button type="button" class="secondary" data-expand-preview aria-expanded="false">Expand preview</button></div><p class="hint">Browser approximation of Discord Components V2. Final spacing and component rendering are controlled by Discord.</p><label for="card-preview-mode">Preview state</label><select id="card-preview-mode"><option value="current">Current cached state</option><option value="online">Online example</option><option value="offline">Offline example</option><option value="pending">Pending example</option><option value="missing">Telemetry unavailable example</option></select><p class="hint" id="card-preview-source" role="status">Current cached telemetry</p><details open class="preview-card-disclosure"><summary>Card preview · collapse / expand</summary><div id="card-preview-lines"></div><div id="card-preview-artwork"></div><div id="card-preview-actions"></div></details></aside>`;
  const lineEditor = (line: (typeof editorLines)[number]): string => {
    const name = `Card Line ${String(CARD_LINE_IDS.indexOf(line.id) + 1)}`;
    const target = `${line.id}Template`;
    const defaultTemplate =
      line.id === 'subtitle'
        ? '{statusicon} {status} · {location}'
        : DEFAULT_CARD_TEMPLATES[line.id];
    return `<details class="card-line-editor" data-card-line="${line.id}"${line.id === editorLines[0]?.id ? ' open' : ''}><summary><span class="line-summary-title">${name}</span><span class="line-summary-text" data-line-summary>${escapeHtml(line.template || 'Empty line')}</span><span class="line-summary-meta" data-line-meta>${line.visible ? 'Visible' : 'Hidden'} · ${styleNames[line.style as keyof typeof styleNames]}</span></summary><div class="card-line-content">
<label class="checkbox"><input type="checkbox" name="show${line.id.charAt(0).toUpperCase()}${line.id.slice(1)}" value="1"${line.visible ? ' checked' : ''}> Show ${name}</label>
<div class="description-toolbar" role="group" aria-label="${name} text styling">${[
      ['Bold', '**'],
      ['Italic', '*'],
      ['Underline', '__'],
      ['Strikethrough', '~~'],
      ['Inline code', String.fromCharCode(96)],
    ]
      .map(
        ([label, marker]) =>
          `<button class="secondary" type="button" aria-controls="${target}" data-markdown-target="${target}" data-markdown-marker="${escapeHtml(marker)}">${escapeHtml(label ?? '')}</button>`,
      )
      .join('')}</div>
<label for="${line.id}Style">${name} heading style</label><select id="${line.id}Style" name="${line.id}Style" data-line-style>${CARD_LINE_STYLES.map((style) => `<option value="${style}"${line.style === style ? ' selected' : ''}>${styleNames[style]}</option>`).join('')}</select>
${textarea(`${name} template`, target, line.template, 'maxlength="500" data-card-template', model.fieldErrors?.[target])}
<p class="hint" id="${target}-format-status" role="status">Select text to apply formatting, or insert a placeholder at the cursor.</p>
<div class="actions"><select aria-label="${name} placeholder" data-line-placeholder>${placeholderOptions}</select><button type="button" class="secondary" data-insert-line-placeholder="${target}">Insert placeholder</button><button type="button" class="secondary" data-reset-line="${line.id}" data-reset-value="${escapeHtml(defaultTemplate)}" data-reset-style="${DEFAULT_CARD_LINE_STYLES[line.id]}">Restore default</button><button type="button" class="secondary" data-move-line="up" aria-label="Move ${name} up">Up</button><button type="button" class="secondary" data-move-line="down" aria-label="Move ${name} down">Down</button></div></div></details>`;
  };
  const form = actionForm(
    `/admin/guilds/${escapeHtml(model.guildId)}/game-servers/${escapeHtml(model.server.id)}/edit`,
    model.csrf,
    `<input type="hidden" name="version" value="${escapeHtml(value('version', model.server.version))}">
${model.submitted === undefined ? '' : '<input type="hidden" data-submitted-edits>' + notice('These are unsaved edits. Saved values are shown below. Reload before retrying a configuration conflict.', 'warning')}
<nav class="game-server-section-nav" aria-label="Configuration sections"><a href="#server-settings">Server Settings</a><a href="#card-designer">Card Designer</a><a href="#live-data">Live Data</a><a href="#advanced-settings">Advanced</a><a href="#deployments">Deployments</a><a href="#diagnostics">Diagnostics</a></nav>
<fieldset id="server-settings" class="game-server-config-group"><legend>Registration and monitoring</legend>
<div><label class="checkbox"><input type="checkbox" name="enabled" value="1"${checked('enabled') ? ' checked' : ''}> Enable polling</label>
<p class="hint">Disabling polling preserves existing displays and their last observation.</p></div>
<div><label class="checkbox"><input type="checkbox" name="public" value="1"${checked('public') ? ' checked' : ''}> Public visibility</label>
<p class="hint">Making a server private removes its Discord displays. Registration remains saved.</p></div>
${input('Sort order', 'sortOrder', value('sortOrder', model.server.sortOrder), 'number', 'min="0"', model.fieldErrors?.sortOrder)}
</fieldset><fieldset id="card-designer" class="game-server-config-group"><legend>Card Designer</legend>
${input('Display name', 'displayName', value('displayName', model.server.displayName), 'text', 'maxlength="64" required', model.fieldErrors?.displayName)}
<fieldset id="card-text-settings" class="game-server-config-group"><legend>Card Layout Builder</legend>
<input type="hidden" name="linesVersion" value="1"><input type="hidden" name="lineOrder" id="card-line-order" value="${escapeHtml(editorLines.map((line) => line.id).join(','))}"><input type="hidden" name="layoutVersion" value="3"><input type="hidden" name="layoutJson" id="card-layout-json" value="${escapeHtml(layoutJsonValue)}">
<input type="hidden" name="fieldOrder" value="${escapeHtml(profile.fieldOrder.join(','))}">
<p class="hint">Manage text and layout elements below. Reorder with Up/Down. Hidden or empty elements do not appear.</p><details class="inline-help"><summary>Text and Discord layout help</summary><p>Text styles use Discord Markdown, and Small text uses <code>-#</code>. Sections keep thumbnails attached as Discord requires. Discord controls final spacing and limits total card text to 4,000 characters.</p></details>
${legacyUpdatesWarning}<details class="layout-add-menu"><summary>Add element</summary><div class="layout-add-actions" aria-label="Add card layout element"><button type="button" class="secondary" data-add-layout="text">Add Text Line</button><button type="button" class="secondary" data-add-layout="gallery">Add Image Gallery</button><button type="button" class="secondary" data-add-layout="separator">Add Separator</button><button type="button" class="secondary" data-add-layout="section">Add Text + Thumbnail Section</button><button type="button" class="secondary" data-add-layout="actions">Add Action Buttons</button><button type="button" class="secondary" data-add-layout="updates">Community Updates preset</button></div></details><div id="card-layout-workspace"><section id="card-layout-list" aria-label="Card elements"><h3>Elements</h3><p class="hint">Select a block to edit its properties.</p><div id="card-layout-editors"></div><p class="hint" id="card-layout-status" role="status" aria-live="polite"></p><div id="card-layout-undo" role="status" aria-live="polite"></div></section><section id="card-layout-properties" aria-label="Element properties"><p class="hint">Choose an element to begin editing.</p></section></div>
<div id="card-line-editors" hidden>${editorLines.map(lineEditor).join('')}</div>
</fieldset>
<details class="card-settings-group"><summary>Appearance</summary><div class="card-settings-content"><label class="checkbox" hidden><input type="checkbox" name="showMapArtwork" value="1"${(model.submitted === undefined ? (profile.mapArtwork ?? profile.visibleFields.currentMap) : model.submitted.showMapArtwork === '1') ? ' checked' : ''}> Show map artwork</label><p class="hint">Control each gallery’s artwork and visibility in its element properties.</p>

${input('Accent color', 'accentColor', value('accentColor', profile.accentColor), 'text', 'pattern="#[0-9a-fA-F]{6}" maxlength="7" required', model.fieldErrors?.accentColor)}
${input('Thumbnail HTTPS URL', 'thumbnailImageUrl', value('thumbnailImageUrl', profile.thumbnailImageUrl), 'url', 'maxlength="500"', model.fieldErrors?.thumbnailImageUrl)}
<p class="hint">Blank thumbnail uses the default server icon.</p>
${input('Map artwork fallback HTTPS URL', 'imageUrl', value('imageUrl', model.server.imageUrl), 'url', 'maxlength="500" placeholder="https://..."', model.fieldErrors?.imageUrl)}
<p class="hint">Known local map artwork takes priority; this URL is used when map artwork is unavailable.</p>
</div></details><details class="card-settings-group" id="card-button-settings"><summary>Action Buttons</summary><div class="card-settings-content"><label class="checkbox"><input type="checkbox" name="showConnectButton" value="1"${buttonChecked('connect') ? ' checked' : ''}> Show Connect button</label>${input('Connect button label', 'connectButtonLabel', typeof model.submitted?.connectButtonLabel === 'string' ? model.submitted.connectButtonLabel : profile.buttons.connectLabel, 'text', 'maxlength="80" required')}
<label class="checkbox"><input type="checkbox" name="showMapRulesButton" value="1"${buttonChecked('mapRules') ? ' checked' : ''}> Show Map & Rules button</label>${input('Map & Rules button label', 'mapRulesButtonLabel', typeof model.submitted?.mapRulesButtonLabel === 'string' ? model.submitted.mapRulesButtonLabel : profile.buttons.mapRulesLabel, 'text', 'maxlength="80" required')}
</div></details><details class="card-settings-group"><summary>Status Presentation</summary><div class="card-settings-content">${input('Online status label', 'onlineStatusLabel', typeof model.submitted?.onlineStatusLabel === 'string' ? model.submitted.onlineStatusLabel : profile.statusLabels.online, 'text', 'maxlength="80" required')}
${input('Offline status label', 'offlineStatusLabel', typeof model.submitted?.offlineStatusLabel === 'string' ? model.submitted.offlineStatusLabel : profile.statusLabels.offline, 'text', 'maxlength="80" required')}
${input('Starting status label', 'startingStatusLabel', typeof model.submitted?.startingStatusLabel === 'string' ? model.submitted.startingStatusLabel : profile.statusLabels.starting, 'text', 'maxlength="80" required')}
${input('Stale status label', 'staleStatusLabel', typeof model.submitted?.staleStatusLabel === 'string' ? model.submitted.staleStatusLabel : profile.statusLabels.stale, 'text', 'maxlength="80" required')}
${input('Pending status label', 'pendingStatusLabel', typeof model.submitted?.pendingStatusLabel === 'string' ? model.submitted.pendingStatusLabel : profile.statusLabels.pending, 'text', 'maxlength="80" required')}
${input('Unavailable status label', 'unavailableStatusLabel', typeof model.submitted?.unavailableStatusLabel === 'string' ? model.submitted.unavailableStatusLabel : profile.statusLabels.unavailable, 'text', 'maxlength="80" required')}
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
</div></details><details id="advanced-settings" class="game-server-advanced"><summary>Advanced appearance and connection settings</summary><div class="card-line-content">
${input('Connect domain', 'connectDomain', value('connectDomain', model.server.connectDomain), 'text', 'maxlength="256" placeholder="e.g. arena.example.com"', model.fieldErrors?.connectDomain)}
${input('HTTPS join URL', 'joinUrl', value('joinUrl', model.server.joinUrl), 'url', 'maxlength="500" placeholder="https://..."', model.fieldErrors?.joinUrl)}
<p class="hint">The join URL appears in the server detail response. The card Connect button provides the server address.</p>
</div></details>
<div class="card-default-actions"><button type="button" class="secondary" data-reset-card-profile data-default-layout="${escapeHtml(JSON.stringify({ version: 3, elements: resolveCardLayout(undefined, null) }))}" data-defaults="${escapeHtml(JSON.stringify({ titleTemplate: DEFAULT_CARD_TEMPLATES.title, subtitleTemplate: '{statusicon} {status} · {location}', descriptionTemplate: DEFAULT_CARD_TEMPLATES.description, playerCountTemplate: DEFAULT_CARD_TEMPLATES.playerCount, currentMapTemplate: DEFAULT_CARD_TEMPLATES.currentMap, serverAddressTemplate: DEFAULT_CARD_TEMPLATES.serverAddress, showTitle: true, showSubtitle: true, showDescription: true, showPlayerCount: true, showCurrentMap: true, showServerAddress: true, showUpdates: true, fieldOrder: 'description,currentMap,serverAddress', lineOrder: CARD_LINE_IDS.join(','), showMapArtwork: true, ...Object.fromEntries(CARD_LINE_IDS.map((id) => [`${id}Style`, DEFAULT_CARD_LINE_STYLES[id]])), showConnectButton: true, showMapRulesButton: true, connectButtonLabel: 'Connect', mapRulesButtonLabel: 'Map & Rules', onlineStatusLabel: DEFAULT_STATUS_LABELS.online, offlineStatusLabel: DEFAULT_STATUS_LABELS.offline, startingStatusLabel: DEFAULT_STATUS_LABELS.starting, staleStatusLabel: DEFAULT_STATUS_LABELS.stale, pendingStatusLabel: DEFAULT_STATUS_LABELS.pending, unavailableStatusLabel: DEFAULT_STATUS_LABELS.unavailable, accentColor: '#2b8aef', thumbnailImageUrl: '', imageUrl: '', onlineEmojiId: '', offlineEmojiId: '', warningEmojiId: '', pendingEmojiId: '' }))}">Restore card defaults</button><p class="hint">Restore the card layout and appearance to their defaults.</p></div></fieldset>
${preview}
<div class="notice warning">This webpanel changes only the bot's local registration. It does not mutate the DatHost server.</div>
<div class="game-server-savebar"><p class="hint" id="card-config-dirty-status" role="status" aria-live="polite">All changes saved.</p><button type="button" class="secondary" data-discard-server-changes>Discard changes</button><button type="submit">Save changes</button></div>`,
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
        `<p>Saved configuration · Version ${String(model.server.version)} · ${String(savedLayout.length)} elements</p><details class="card-settings-group"><summary>Inspect saved configuration</summary><p>These values reflect saved configuration, before any unsaved edits above.</p><dl class="dl"><dt>Name</dt><dd>${escapeHtml(model.server.displayName)}</dd><dt>Description template</dt><dd>${escapeHtml(savedDescription)}</dd><dt>Online label</dt><dd>${escapeHtml(profile.statusLabels.online)}</dd><dt>Offline label</dt><dd>${escapeHtml(profile.statusLabels.offline)}</dd><dt>Legacy text lines</dt><dd>${savedLines.map((line) => `Card Line ${String(CARD_LINE_IDS.indexOf(line.id) + 1)}: ${escapeHtml(line.template)} (${escapeHtml(line.style)}, ${line.visible ? 'visible' : 'hidden'})`).join('<br>')}</dd><dt>Accent</dt><dd>${escapeHtml(profile.accentColor)}</dd><dt>Thumbnail</dt><dd>${escapeHtml(effective.thumbnailImageUrl)}</dd>${(['online', 'offline', 'warning', 'pending'] as const).map((state) => `<dt>${state} emoji</dt><dd>${escapeHtml(effective[`${state}EmojiId`] ?? 'Plain dot')}</dd>`).join('')}</dl><h3>Saved layout</h3><pre class="saved-layout-json">${escapeHtml(JSON.stringify({ version: 3, elements: savedLayout }, null, 2))}</pre></details>`,
      ) +
      `<div id="live-data">${card('Live state', readOnly)}</div>` +
      `<div id="deployments">${card('Discord displays', cardInfo)}</div>`,
  );
}

function selectedValueSelect(
  label: string,
  name: string,
  items: Array<{ id: string; name: string }>,
  selected: string | string[],
  attributes: string,
  id = name,
  placeholder?: string,
): string {
  const hintId = `${id}-selected-value`;
  return `${select(label, name, items, selected, `${attributes} aria-describedby="${hintId}"`, placeholder, undefined, id)}${selectedValueHint(hintId, items, selected, placeholder)}`;
}

function selectedValueHint(
  hintId: string,
  items: Array<{ id: string; name: string }>,
  selected: string | string[],
  placeholder?: string,
): string {
  const values = (Array.isArray(selected) ? selected : [selected]).filter((id) => id !== '');
  const names = (
    values.length === 0 && placeholder === undefined
      ? items.slice(0, 1).map((item) => item.id)
      : values
  )
    .map((id) => items.find((item) => item.id === id)?.name ?? id)
    .map((name) => escapeHtml(name));
  return `<p class="hint selected-value" id="${escapeHtml(hintId)}" aria-live="polite">${names.length === 0 ? (placeholder ?? 'No options available.') : `Selected: ${names.join(', ')}`}</p>`;
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
