import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { JobHandler } from '../../jobs/worker.js';

export interface ApplicationCommand {
  name: string;
}

export interface ModuleInteractionContext {
  interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;
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
