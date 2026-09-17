import { describe, expect, it } from 'vitest';
import { escapeHtml, guildIndex, rewardsPage } from '../../../src/http/admin/views.js';

describe('admin views', () => {
  it('escapes untrusted text', () => {
    expect(escapeHtml('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
    expect(
      guildIndex('owner', 'csrf', [
        {
          id: '12345678901234567',
          name: '<img src=x>',
          tenManConfigured: false,
          tenManEnabled: false,
          rewardsConfigured: true,
          rewardsEnabled: true,
          managedState: 'NONE',
        },
      ]),
    ).not.toContain('<img src=x>');
  });

  it('escapes reward level labels and renders CSRF-protected forms', () => {
    const html = rewardsPage({
      id: '12345678901234567',
      name: 'Office',
      csrf: 'csrf-token',
      adjustmentId: '123e4567-e89b-12d3-a456-426614174000',
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
    expect(html).toContain('/rewards/adjust');
  });
});
