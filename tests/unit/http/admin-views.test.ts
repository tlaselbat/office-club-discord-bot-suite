import { describe, expect, it } from 'vitest';
import {
  adminShell,
  escapeHtml,
  guildIndex,
  multiSelect,
  panelCss,
  rewardsPage,
  select,
  table,
} from '../../../src/http/admin/views.js';

describe('admin views', () => {
  it('lets the game server editor use its responsive two-column layout', () => {
    expect(panelCss).toContain(
      'form[action$="/edit"]{width:100%;max-width:none;min-width:0;display:grid',
    );
    expect(panelCss).toContain(
      '@media(max-width:800px){form[action$="/edit"]{grid-template-columns:minmax(0,1fr)}',
    );
    expect(panelCss).toContain('.game-server-section-nav a[aria-current="location"]');
  });

  it('marks only the current module in guild navigation', () => {
    const html = adminShell(
      {
        title: 'Edit server',
        username: 'owner',
        csrf: 'csrf',
        currentPath: '/admin/guilds/123/game-servers/server-1',
        currentGuildId: '123',
      },
      '<p>Settings</p>',
    );

    expect(html).toMatch(/Game Servers<\/a>/);
    expect(html).toMatch(/game-servers" aria-current="page">Game Servers<\/a>/);
    expect(html).not.toMatch(/guilds\/123" aria-current="page">Overview<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('escapes untrusted text', () => {
    expect(escapeHtml('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
    expect(
      guildIndex('owner', 'csrf', [
        {
          id: '12345678901234567',
          name: '<img src=x>',
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
            {
              key: 'rewards',
              label: 'Rewards',
              release: 'In development',
              releaseVariant: 'in-development',
              operational: 'Enabled',
              operationalVariant: 'enabled',
              configured: true,
              enabled: true,
              version: 1,
            },
          ],
        },
      ]),
    ).not.toContain('<img src=x>');
  });

  it('keeps select form names while permitting a distinct safe control id', () => {
    const html = select(
      'Move to channel',
      'channelId',
      [{ id: 'channel-1', name: 'announcements' }],
      '',
      'required',
      undefined,
      undefined,
      'display-1-channelId',
    );

    expect(html).toContain('for="display-1-channelId"');
    expect(html).toContain('id="display-1-channelId" name="channelId"');
  });

  it('connects multi-select hints and errors to their control', () => {
    const html = multiSelect(
      'Channels',
      'channelIds',
      [{ id: 'channel-1', name: 'announcements' }],
      [],
      '',
      ['Select at least one channel.'],
    );

    expect(html).toContain('id="channelIds-hint"');
    expect(html).toContain('aria-describedby="channelIds-hint channelIds-error"');
    expect(html).toContain('aria-invalid="true"');
  });

  it('keeps record labels visible when tables reflow on narrow screens', () => {
    const html = table(['Time', 'Summary'], [['today', 'A long & useful summary']]);

    expect(html).toContain('class="table--records"');
    expect(html).toContain('<th scope="col">Summary</th>');
    expect(html).toContain('<td data-label="Summary">A long & useful summary</td>');
  });

  it('escapes reward level labels and renders CSRF-protected forms', () => {
    const html = rewardsPage({
      id: '12345678901234567',
      name: 'Office',
      username: 'owner',
      csrf: 'csrf-token',
      adjustmentId: '123e4567-e89b-12d3-a456-426614174000',
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
      levels: [{ level: 1, xpThreshold: 100, label: '<script>', roleId: null }],
      textChannels: [],
      voiceChannels: [],
      roles: [],
      members: [{ id: '12345678901234567', name: 'Member' }],
      ledgerEntries: [],
      diagnostics: [{ label: 'Rewards worker jobs', ok: true }],
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('name="csrf" value="csrf-token"');
    expect(html).toContain('/rewards/settings');
  });
});
