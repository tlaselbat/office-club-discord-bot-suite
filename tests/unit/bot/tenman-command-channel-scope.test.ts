import { describe, expect, it } from 'vitest';
import { isManagedTenManCommandChannel, isTenManSetupCommand } from '../../../src/bot/client.js';

const activeSettings = {
  managedResourceState: 'ACTIVE' as const,
  managedChannelIds: ['lobby-text', 'lobby-voice', 'team-1', 'team-2'],
};

describe('10man slash-command channel scope', () => {
  it('allows commands only in persisted active managed channels', () => {
    expect(isManagedTenManCommandChannel('lobby-text', activeSettings)).toBe(true);
    expect(isManagedTenManCommandChannel('general', activeSettings)).toBe(false);
    expect(isManagedTenManCommandChannel(null, activeSettings)).toBe(false);
    expect(
      isManagedTenManCommandChannel('lobby-text', {
        ...activeSettings,
        managedResourceState: 'NONE',
      }),
    ).toBe(false);
  });

  it('keeps only /match admin setup as the bootstrap exception', () => {
    expect(
      isTenManSetupCommand({
        commandName: 'match',
        options: { getSubcommandGroup: () => 'admin', getSubcommand: () => 'setup' },
      }),
    ).toBe(true);
    expect(
      isTenManSetupCommand({
        commandName: 'match',
        options: { getSubcommandGroup: () => 'admin', getSubcommand: () => 'diagnostics' },
      }),
    ).toBe(false);
  });
});
