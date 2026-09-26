import { describe, expect, it, vi } from 'vitest';
import { ModuleRegistry } from '../../../../src/core/modules/registry.js';
import type { SuiteModule } from '../../../../src/core/modules/types.js';
import type { JobHandler } from '../../../../src/jobs/worker.js';
import { createCompetitiveModule } from '../../../../src/modules/tenman/module.js';

const command = (name: string) => ({ name });
const collisionHandler: JobHandler = async () => undefined;

describe('ModuleRegistry', () => {
  it('composes commands and jobs', () => {
    const handler: JobHandler = vi.fn().mockResolvedValue(undefined);
    const registry = new ModuleRegistry([
      {
        key: 'one',
        displayName: 'One',
        commands: [command('one')],
        jobHandlers: new Map([['ONE_JOB', handler]]),
      },
      { key: 'two', displayName: 'Two', commands: [command('two')] },
    ]);

    expect(registry.commands().map((item) => item.name)).toEqual(['one', 'two']);
    expect(registry.jobHandlers().get('ONE_JOB')).toBe(handler);
  });

  it.each([
    [
      { key: 'same', displayName: 'One' },
      { key: 'same', displayName: 'Two' },
      'Duplicate module key',
    ],
    [
      { key: 'one', displayName: 'One', commands: [command('shared')] },
      { key: 'two', displayName: 'Two', commands: [command('shared')] },
      'Duplicate command',
    ],
    [
      { key: 'one', displayName: 'One', componentPrefixes: ['suite:'] },
      { key: 'two', displayName: 'Two', componentPrefixes: ['suite:'] },
      'Duplicate component prefix',
    ],
    [
      { key: 'one', displayName: 'One', jobHandlers: new Map([['SHARED', collisionHandler]]) },
      { key: 'two', displayName: 'Two', jobHandlers: new Map([['SHARED', collisionHandler]]) },
      'Duplicate job type',
    ],
  ] satisfies [SuiteModule, SuiteModule, string][])(
    'rejects namespace collisions',
    (one, two, message) => {
      expect(() => new ModuleRegistry([one, two])).toThrow(message);
    },
  );

  it('dispatches commands and longest matching component prefix', async () => {
    const broad = vi.fn().mockResolvedValue(undefined);
    const specific = vi.fn().mockResolvedValue(undefined);
    const registry = new ModuleRegistry([
      {
        key: 'broad',
        displayName: 'Broad',
        componentPrefixes: ['suite:'],
        handleInteraction: broad,
      },
      {
        key: 'specific',
        displayName: 'Specific',
        commands: [command('specific')],
        componentPrefixes: ['suite:specific:'],
        handleInteraction: specific,
      },
    ]);
    const component = { isChatInputCommand: () => false, customId: 'suite:specific:next' };
    const chat = { isChatInputCommand: () => true, commandName: 'specific' };

    await expect(registry.dispatch(component as never)).resolves.toBe(true);
    await expect(registry.dispatch(chat as never)).resolves.toBe(true);
    expect(broad).not.toHaveBeenCalled();
    expect(specific).toHaveBeenCalledTimes(2);
  });

  it.each(['tmo:', 'tqb:', 'tqc:', 'tqm:', 'tqmp:', 'tqa:', 'tpy:'])(
    'dispatches the %s competitive component namespace',
    async (prefix) => {
      const handleInteraction = vi.fn().mockResolvedValue(undefined);
      const registry = new ModuleRegistry([{ ...createCompetitiveModule(), handleInteraction }]);
      const component = { isChatInputCommand: () => false, customId: `${prefix}signed-payload` };

      await expect(registry.dispatch(component as never)).resolves.toBe(true);
      expect(handleInteraction).toHaveBeenCalledOnce();
    },
  );

  it('starts in registration order and stops in reverse order', async () => {
    const calls: string[] = [];
    const registry = new ModuleRegistry([
      {
        key: 'one',
        displayName: 'One',
        start: async () => void calls.push('start-one'),
        stop: async () => void calls.push('stop-one'),
      },
      {
        key: 'two',
        displayName: 'Two',
        start: async () => void calls.push('start-two'),
        stop: async () => void calls.push('stop-two'),
      },
    ]);

    await registry.start();
    await registry.stop();
    expect(calls).toEqual(['start-one', 'start-two', 'stop-two', 'stop-one']);
  });
});
