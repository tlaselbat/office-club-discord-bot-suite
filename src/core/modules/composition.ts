import type { SuiteModule } from './types.js';
import { createCompetitiveModule } from '../../modules/tenman/module.js';
import type { WorkerDependencies } from '../../modules/tenman/jobs/handlers.js';
import {
  createRewardsModule,
  type RewardsModuleDependencies,
} from '../../modules/rewards/module.js';
import {
  createGameServersModule,
  type GameServersModuleDependencies,
} from '../../modules/game-servers/module.js';

export interface SuiteCompositionOptions {
  competitive?: {
    dependencies?: WorkerDependencies;
    handleInteraction?: SuiteModule['handleInteraction'];
  };
  rewards?: RewardsModuleDependencies;
  gameServers?: GameServersModuleDependencies;
}

export function createSuiteModules(options: SuiteCompositionOptions = {}): SuiteModule[] {
  const competitive = createCompetitiveModule(options.competitive?.dependencies);
  return [
    options.competitive?.handleInteraction === undefined
      ? competitive
      : { ...competitive, handleInteraction: options.competitive.handleInteraction },
    createRewardsModule(options.rewards),
    createGameServersModule(options.gameServers),
  ];
}
