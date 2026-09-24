import { z } from 'zod';
import { registerCommands } from './bot/client.js';
import { ModuleRegistry } from './core/modules/registry.js';
import { createCompetitiveModule } from './modules/tenman/module.js';
import { createRewardsModule } from './modules/rewards/module.js';

const environment = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  })
  .parse(process.env);

const registry = new ModuleRegistry([createCompetitiveModule(), createRewardsModule()]);

registerCommands(environment.DISCORD_TOKEN, environment.DISCORD_CLIENT_ID, registry.commands())
  .then(() => process.stdout.write('Discord slash commands registered.\n'))
  .catch((error: unknown) => {
    process.stderr.write(
      `Command registration failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  });
