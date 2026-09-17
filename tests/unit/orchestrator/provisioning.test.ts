import { describe, expect, it, vi } from 'vitest';
import type { DatHostServer } from '../../../src/modules/tenman/integrations/dathost/schemas.js';
import {
  ProvisioningOrchestrator,
  type ProvisioningAttemptRecord,
  type ProvisioningRepository,
} from '../../../src/modules/tenman/orchestrator/provisioning.js';

class MemoryAttempts implements ProvisioningRepository {
  public attempt: ProvisioningAttemptRecord | null = null;
  public unknown = false;
  public findUnresolved(): Promise<ProvisioningAttemptRecord | null> {
    return Promise.resolve(this.attempt);
  }
  public createIntent(attempt: ProvisioningAttemptRecord): Promise<void> {
    this.attempt = attempt;
    return Promise.resolve();
  }
  public markUnknown(_id: string, finishedAt: Date): Promise<void> {
    if (this.attempt !== null)
      this.attempt = {
        ...this.attempt,
        status: 'DUPLICATE_OUTCOME_UNKNOWN',
        requestFinishedAt: finishedAt,
      };
    this.unknown = true;
    return Promise.resolve();
  }
  public identify(_id: string, server: DatHostServer): Promise<void> {
    if (this.attempt !== null)
      this.attempt = { ...this.attempt, status: 'SERVER_IDENTIFIED', serverId: server.id };
    return Promise.resolve();
  }
  public markAmbiguous(): Promise<void> {
    if (this.attempt !== null) this.attempt = { ...this.attempt, status: 'AMBIGUOUS' };
    return Promise.resolve();
  }
}

const context = {
  matchId: '123e4567-e89b-12d3-a456-426614174000',
  guildId: 'guild',
  templateServerId: 'template',
  location: 'dallas',
  slots: 11,
};
const server: DatHostServer = {
  id: 'destination',
  name: 'provisional',
  location: 'dallas',
  created_at: 1,
  booting: false,
};

describe('provisioning orchestrator', () => {
  it('persists the destination before duplicate and never blindly retries a lost response', async () => {
    const repository = new MemoryAttempts();
    const duplicateServer = vi.fn().mockRejectedValue(new Error('connection lost'));
    const orchestrator = new ProvisioningOrchestrator(
      repository,
      {
        createProvisionalServer: vi.fn().mockResolvedValue(server),
        duplicateServer,
        listServers: vi.fn().mockResolvedValue([server]),
        updateServer: vi.fn(),
      },
      new Set(['template']),
    );
    await expect(orchestrator.provision(context)).resolves.toBeNull();
    expect(repository.attempt?.serverId).toBe('destination');
    expect(repository.unknown).toBe(true);
    await orchestrator.provision(context);
    expect(duplicateServer).toHaveBeenCalledOnce();
  });

  it('duplicates into and configures only the persisted destination', async () => {
    const repository = new MemoryAttempts();
    const updateServer = vi.fn().mockResolvedValue(server);
    const duplicateServer = vi.fn().mockResolvedValue(server);
    const orchestrator = new ProvisioningOrchestrator(
      repository,
      {
        createProvisionalServer: vi.fn().mockResolvedValue(server),
        duplicateServer,
        listServers: vi.fn(),
        updateServer,
      },
      new Set(['template']),
    );
    await expect(orchestrator.provision(context)).resolves.toEqual(server);
    expect(duplicateServer).toHaveBeenCalledWith('template', 'dallas', 'destination');
    const ownershipMarker = repository.attempt?.ownershipMarker;
    if (ownershipMarker === undefined) throw new Error('Missing provisioning attempt');
    expect(updateServer).toHaveBeenCalledWith(
      'destination',
      expect.objectContaining({ user_data: ownershipMarker }),
    );
  });
});
