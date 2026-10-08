import { describe, expect, it } from 'vitest';
import {
  auditPage,
  competitivePage,
  escapeHtml,
  gameServerEditPage,
  gameServersPage,
  generalPage,
  guildIndex,
  rewardsPage,
} from '../../../src/http/admin/views.js';

describe('admin page views', () => {
  it('guild index renders module summaries safely', () => {
    const html = guildIndex('owner', 'csrf', [
      {
        id: '12345678901234567',
        name: '<b>Guild</b>',
        modules: [
          {
            key: 'game-servers',
            label: 'Game Servers',
            release: 'Production ready',
            releaseVariant: 'production-ready',
            operational: 'Enabled',
            operationalVariant: 'enabled',
            configured: true,
            enabled: true,
            version: 1,
          },
          {
            key: 'competitive',
            label: 'Competitive',
            release: 'In development',
            releaseVariant: 'in-development',
            operational: 'Unconfigured',
            operationalVariant: 'unconfigured',
            configured: false,
            enabled: false,
            version: null,
          },
        ],
      },
    ]);
    expect(html).not.toContain('<b>Guild</b>');
    expect(html).toContain('Game Servers');
    expect(html).toContain('In development');
  });

  it('general page escapes guild name and includes module cards', () => {
    const html = generalPage({
      id: '12345678901234567',
      name: '<script>alert("x")</script>',
      username: 'owner',
      csrf: 'csrf-token',
      discordAvailable: true,
      modules: [
        {
          key: 'game-servers',
          label: 'Game Servers',
          release: 'Production ready',
          releaseVariant: 'production-ready',
          operational: 'Enabled',
          operationalVariant: 'enabled',
          configured: true,
          enabled: true,
          version: 1,
          href: '/admin/guilds/12345678901234567/game-servers',
          primaryAction: { label: 'Manage', href: '/admin/guilds/12345678901234567/game-servers' },
        },
        {
          key: 'competitive',
          label: 'Competitive',
          release: 'In development',
          releaseVariant: 'in-development',
          operational: 'Disabled',
          operationalVariant: 'disabled',
          configured: true,
          enabled: false,
          version: 2,
          href: '/admin/guilds/12345678901234567/competitive',
        },
      ],
      recentAudit: [],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('Manage');
    expect(html).toContain('/admin/guilds/12345678901234567/game-servers');
  });

  it('game servers page renders complete registered-server cards and controls', () => {
    const html = gameServersPage({
      id: '12345678901234567',
      name: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      moduleEnabled: true,
      settingsVersion: 1,
      textChannels: [
        {
          id: '22345678901234567',
          name: '#a very long Discord channel name that must remain readable',
        },
      ],
      servers: [
        {
          id: '32345678901234567',
          displayName: 'Office CS2',
          provider: 'dathost',
          providerServerId: 'abc123',
          enabled: true,
          public: true,
          hostingState: 'ONLINE',
          stale: false,
          lastSuccessfulAt: new Date('2026-01-01T00:00:00Z'),
          consecutiveFailures: 0,
          displays: [{ id: 'card-1', channelName: '#servers' }],
          needsAttention: false,
          version: 3,
        },
      ],
      filter: 'all',
      cards: [
        {
          id: 'card-1',
          gameServerId: '32345678901234567',
          serverName: 'Office CS2',
          channelId: '22345678901234567',
          channelName: '#servers',
          messageId: '42345678901234567',
          state: 'HEALTHY',
          lastReconciledAt: new Date('2026-01-01T00:00:00Z'),
          lastError: null,
        },
      ],
      diagnostics: {
        runAt: new Date('2026-01-01T00:00:00Z'),
        mode: 'persisted',
        settings: [],
        aggregate: [],
        servers: [],
      },
      availableServers: [
        {
          id: 'available-server-1',
          name: 'A very long DatHost server name that must remain readable',
          location: 'Los Angeles',
        },
      ],
    });
    expect(html).toContain('Office CS2');
    expect(html).toContain('ONLINE');
    expect(html).toContain('class="server-grid"');
    expect(html).toContain('class="server-card-title"');
    expect(html).toContain('Polling enabled');
    expect(html).toContain('Last success');
    expect(html).toContain('Failures');
    expect(html).toContain('Displays');
    expect(html).toContain('/game-servers/32345678901234567/toggle-enabled');
    expect(html).toContain('/game-servers/32345678901234567/toggle-public');
    expect(html).toContain('name="version" value="3"');
    expect(html).toContain('Disable polling');
    expect(html).toContain('Make private');
    expect(html).toContain('Production ready');
    expect(html).toContain('Discord displays');
    expect(html).toContain('Publish server card');
    expect(html).not.toContain('Panel destination');
    expect(html).toContain('name="csrf" value="csrf-token"');
    expect(html).toContain(
      'Selected: A very long DatHost server name that must remain readable (Los Angeles)',
    );
    expect(html).toContain('Selected: #a very long Discord channel name that must remain readable');
    expect(html).toContain(
      'id="providerServerId" name="providerServerId" aria-describedby="providerServerId-selected-value"',
    );
    expect(html).toContain('id="providerServerId-selected-value"');
    expect(html).toContain(
      'id="gameServerId" name="gameServerId" required aria-describedby="gameServerId-selected-value"',
    );
    expect(html).toContain('id="gameServerId-selected-value"');
  });

  it('server details render persisted live state and independent display actions', () => {
    const html = gameServerEditPage({
      guildId: '12345678901234567',
      guildName: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      server: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        displayName: 'Office CS2',
        description:
          'A longer server description that needs more than a single line to inspect and edit.',
        enabled: true,
        public: true,
        connectDomain: null,
        joinUrl: null,
        imageUrl: null,
        sortOrder: 0,
        provider: 'dathost',
        providerServerId: 'server',
        version: 1,
      },
      textChannels: [{ id: '22345678901234567', name: 'servers' }],
      cards: [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          channelId: '22345678901234567',
          channelName: 'servers',
          messageId: '32345678901234567',
          state: 'HEALTHY',
          lastReconciledAt: new Date('2026-01-01T00:00:00Z'),
          lastError: null,
        },
      ],
      snapshot: {
        hostingState: 'ONLINE',
        gameplayState: 'LIVE',
        hostname: 'Office CS2',
        rawIp: '127.0.0.1',
        port: 27015,
        map: 'de_dust2',
        players: 2,
        maxPlayers: 10,
        datacenter: 'LA',
        cpuPercent: 10,
        memoryUsageMb: 512,
        averagePingMs: 15,
        packetLossPercent: 0,
        serverVarMs: 0.5,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        lastSuccessfulAt: new Date('2026-01-01T00:00:00Z'),
        lastOnlineAt: new Date('2026-01-01T00:00:00Z'),
        consecutiveFailures: 0,
        stale: false,
        lastError: null,
      },
    });
    expect(html).toContain('Gameplay state');
    expect(html).toContain('Open in Discord');
    expect(html).toContain('Refresh / Repair');
    expect(html).toContain('/displays/123e4567-e89b-12d3-a456-426614174001/move');
    expect(html).toContain(
      '<textarea id="descriptionTemplate" name="descriptionTemplate" rows="4"',
    );
    expect(html).toContain(
      'A longer server description that needs more than a single line to inspect and edit.',
    );
  });

  it('competitive page shows in-development notice and read-only managed guidance', () => {
    const html = competitivePage({
      id: '12345678901234567',
      name: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      version: 1,
      enabled: false,
      release: 'In development',
      releaseVariant: 'in-development',
      managedState: 'SETUP',
      locked: true,
      inDevelopment: true,
      values: {
        version: '1',
        enabled: 'false',
        lobbyTextChannelId: '22345678901234567',
        lobbyVoiceChannelId: '32345678901234567',
        team1VoiceChannelId: '42345678901234567',
        team2VoiceChannelId: '52345678901234567',
        privilegedRoleIds: [],
        moderatorRoleIds: [],
        administratorRoleIds: [],
        dathostTemplateServerId: 'abc',
        defaultServerLocation: '',
        defaultGameProfileKey: 'standard',
      },
      textChannels: [
        {
          id: '22345678901234567',
          name: 'long text channel name that remains readable outside the select',
        },
      ],
      voiceChannels: [
        {
          id: '32345678901234567',
          name: 'long voice channel name that remains readable outside the select',
        },
      ],
      roles: [],
      profiles: [],
      diagnostics: {
        configured: false,
        enabled: false,
        channels: [],
        roles: [],
        permissions: [],
      },
    });
    expect(html).toContain('In development');
    expect(html).toContain('read-only');
    expect(html).toContain(
      'Selected: long text channel name that remains readable outside the select',
    );
  });

  it('rewards page shows in-development notice and disables forms', () => {
    const html = rewardsPage({
      id: '12345678901234567',
      name: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      adjustmentId: 'adj',
      inDevelopment: true,
      releaseVariant: 'in-development',
      settings: {
        version: 1,
        enabled: true,
        textXpAmount: 10,
        textCooldownSeconds: 60,
        voiceXpAmount: 5,
        voiceIntervalSeconds: 300,
        textChannelIds: [],
        voiceChannelIds: [],
        tagRequiredSeconds: 3600,
        tagRewardRoleId: '',
        tagReconcileSeconds: 900,
      },
      levels: [],
      textChannels: [],
      voiceChannels: [],
      roles: [],
      members: [],
      ledgerEntries: [],
      diagnostics: [{ label: 'Rewards worker jobs', ok: true }],
    });
    expect(html).toContain('In development');
    expect(html).toContain('disabled');
  });

  it('audit page renders entries without leaking metadata', () => {
    const html = auditPage({
      id: '12345678901234567',
      name: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      entries: [
        {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          actor: '12345678901234567',
          module: 'Game Servers',
          action: 'game_server_module_enabled',
          result: 'success',
          summary: 'Enabled module',
        },
      ],
    });
    expect(html).toContain('Game Servers');
    expect(html).toContain('Enabled module');
    expect(html).toContain('name="csrf" value="csrf-token"');
  });

  it('escapeHtml escapes dangerous characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
