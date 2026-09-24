import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { JobHandler } from '../../jobs/worker.js';
import type { ApplicationCommand, SuiteModule } from './types.js';

export class ModuleRegistry {
  private readonly commandOwners = new Map<string, SuiteModule>();
  private readonly componentOwners = new Map<string, SuiteModule>();
  private readonly handlers = new Map<string, JobHandler>();

  public constructor(private readonly modules: readonly SuiteModule[]) {
    const keys = new Set<string>();
    for (const module of modules) {
      if (keys.has(module.key)) throw new Error(`Duplicate module key: ${module.key}`);
      keys.add(module.key);
      for (const command of module.commands ?? []) {
        this.claim(this.commandOwners, command.name, module, 'command');
      }
      for (const prefix of module.componentPrefixes ?? []) {
        if (prefix.length === 0) throw new Error(`Empty component prefix in module ${module.key}`);
        this.claim(this.componentOwners, prefix, module, 'component prefix');
      }
      for (const [type, handler] of module.jobHandlers ?? []) {
        if (this.handlers.has(type)) throw new Error(`Duplicate job type: ${type}`);
        this.handlers.set(type, handler);
      }
    }
  }

  public commands(): ApplicationCommand[] {
    return this.modules.flatMap((module) => [...(module.commands ?? [])]);
  }

  public jobHandlers(): ReadonlyMap<string, JobHandler> {
    return this.handlers;
  }

  public async dispatch(
    interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction,
  ): Promise<boolean> {
    const module = interaction.isChatInputCommand()
      ? (this.commandOwners.get(interaction.commandName) ??
        this.modules.find(
          (candidate) => candidate.handlesCommand?.(interaction.commandName) === true,
        ))
      : this.findComponentOwner(interaction.customId);
    if (module?.handleInteraction === undefined) return false;
    await module.handleInteraction({ interaction });
    return true;
  }

  public async start(): Promise<void> {
    for (const module of this.modules) await module.start?.();
  }

  public async stop(): Promise<void> {
    for (const module of [...this.modules].reverse()) await module.stop?.();
  }

  private findComponentOwner(customId: string): SuiteModule | undefined {
    let match: { prefix: string; module: SuiteModule } | undefined;
    for (const [prefix, module] of this.componentOwners) {
      if (
        customId.startsWith(prefix) &&
        (match === undefined || prefix.length > match.prefix.length)
      ) {
        match = { prefix, module };
      }
    }
    return match?.module;
  }

  private claim(
    owners: Map<string, SuiteModule>,
    value: string,
    module: SuiteModule,
    kind: string,
  ): void {
    const owner = owners.get(value);
    if (owner !== undefined) {
      throw new Error(`Duplicate ${kind} ${value}: ${owner.key} and ${module.key}`);
    }
    owners.set(value, module);
  }
}
