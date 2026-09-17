import type { SuiteModule } from '../../core/modules/types.js';
import { createJobHandlers, type WorkerDependencies } from './jobs/handlers.js';
import { commands } from './bot/commands.js';

export function createTenManModule(dependencies?: WorkerDependencies): SuiteModule {
  return {
    key: 'tenman',
    displayName: '10man',
    commands,
    componentPrefixes: ['tm:', 'tma:'],
    ...(dependencies === undefined ? {} : { jobHandlers: createJobHandlers(dependencies) }),
  };
}
