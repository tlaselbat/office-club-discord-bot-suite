import type { SuiteModule } from '../../core/modules/types.js';
import { createJobHandlers, type WorkerDependencies } from './jobs/handlers.js';
import { commands } from './bot/commands.js';

export function createCompetitiveModule(dependencies?: WorkerDependencies): SuiteModule {
  return {
    key: 'competitive',
    displayName: 'Office Club Competitive',
    commands,
    componentPrefixes: [
      'tmq:',
      'tmm:',
      'tma:',
      'tma2:',
      'tps2:',
      'tmp:',
      'tms:',
      'tmd:',
      'tmo:',
      'tqb:',
      'tpy:',
    ],
    ...(dependencies === undefined ? {} : { jobHandlers: createJobHandlers(dependencies) }),
  };
}
