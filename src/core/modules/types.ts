import type { ChatInputCommandInteraction, MessageComponentInteraction } from 'discord.js';
import type { JobHandler } from '../../jobs/worker.js';

export interface ApplicationCommand {
  name: string;
}

export interface ModuleInteractionContext {
  interaction: ChatInputCommandInteraction | MessageComponentInteraction;
}

export interface SuiteModule {
  key: string;
  displayName: string;
  commands?: readonly ApplicationCommand[];
  componentPrefixes?: readonly string[];
  jobHandlers?: ReadonlyMap<string, JobHandler>;
  handlesCommand?: (commandName: string) => boolean;
  handleInteraction?: (context: ModuleInteractionContext) => Promise<void>;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
}
