import { describe, expect, it } from 'vitest';
import {
  auditPage,
  competitivePage,
  escapeHtml,
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
          },
          {
            key: 'competitive',
            label: 'Competitive',
            release: 'In development',
            releaseVariant: 'in-development',
            operational: 'Unconfigured',
            operationalVariant: 'unconfigured',
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
          href: '/admin/guilds/12345678901234567/game-servers',
          primaryAction: { label: 'Manage', href: '/admin/guilds/12345678901234567/game-servers' },
        },
      ],
      recentAudit: [],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('Manage');
    expect(html).toContain('/admin/guilds/12345678901234567/game-servers');
  });

  it('game servers page renders status and registered server rows', () => {
    const html = gameServersPage({
      id: '12345678901234567',
      name: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      moduleEnabled: true,
      settingsVersion: 1,
      panelChannelId: '22345678901234567',
      panelChannelName: '#servers',
      panelMessageOk: true,
      textChannels: [{ id: '22345678901234567', name: '#servers' }],
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
          cardCount: 1,
          needsAttention: false,
        },
      ],
      filter: 'all',
      diagnostics: {
        runAt: new Date('2026-01-01T00:00:00Z'),
        mode: 'persisted',
        settings: [],
        aggregate: [],
        servers: [],
      },
      availableServers: [],
    });
    expect(html).toContain('Office CS2');
    expect(html).toContain('ONLINE');
    expect(html).toContain('Production ready');
    expect(html).toContain('name="csrf" value="csrf-token"');
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
      textChannels: [],
      voiceChannels: [],
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
