import { describe, expect, it } from 'vitest';
import { commands } from '../../../src/modules/tenman/bot/commands.js';

const RAW_ID_PATTERN = /_id$|^id$|uuid/i;

type CommandOption = {
  name: string;
  type: number;
  options?: CommandOption[];
};

function collectOptions(options: readonly CommandOption[] | undefined): CommandOption[] {
  if (options === undefined) return [];
  return options.flatMap((option) => [option, ...collectOptions(option.options)]);
}

describe('10man command tree', () => {
  it('registers exactly the consolidated command surface', () => {
    const names = commands.map((command) => command.name);
    expect(names).toEqual(['10man', '10man-admin', '10man-config']);
  });

  it('exposes the player-facing subcommands', () => {
    const tenman = commands.find((command) => command.name === '10man');
    expect(tenman?.options?.map((option) => option.name)).toEqual([
      'hub',
      'account',
      'history',
      'stats',
      'party',
      'alerts',
    ]);
  });

  it('groups staff operations under 10man-admin and lifecycle under 10man-config', () => {
    const admin = commands.find((command) => command.name === '10man-admin');
    expect(admin?.options?.map((option) => option.name)).toEqual([
      'match',
      'queue',
      'players',
      'disputes',
      'diagnostics',
      'queue-panel',
    ]);
    const config = commands.find((command) => command.name === '10man-config');
    expect(config?.options?.map((option) => option.name)).toEqual([
      'status',
      'setup',
      'configure',
      'enable',
      'disable',
      'teardown',
      'recover-setup',
    ]);
  });

  it('exposes no raw identifier options on player-facing commands', () => {
    for (const command of commands) {
      for (const option of collectOptions(command.options as CommandOption[] | undefined)) {
        // Type 1/2 are subcommand/group pseudo-options; leaf options must not
        // require users to paste UUIDs or internal identifiers.
        if (option.type <= 2) continue;
        // dathost_template_server_id is administrator-only infrastructure
        // configuration, not a runtime identifier users resolve from context.
        if (option.name === 'dathost_template_server_id') continue;
        expect(RAW_ID_PATTERN.test(option.name)).toBe(false);
      }
    }
  });

  it('does not register legacy top-level namespaces', () => {
    const names = commands.map((command) => command.name);
    for (const legacy of ['steam', 'match', 'player', 'party']) {
      expect(names).not.toContain(legacy);
    }
  });
});
