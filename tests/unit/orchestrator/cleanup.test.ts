import { describe, expect, it, vi } from 'vitest';
import { CleanupOrchestrator } from '../../../src/modules/tenman/orchestrator/cleanup.js';

const resource = {
  matchId: 'match',
  serverId: 'duplicate',
  ownedServerId: 'duplicate',
  cleanupStatus: 'PENDING' as const,
};

function dependencies(server: { id: string } | null = { id: 'duplicate' }) {
  return {
    repository: {
      markRunning: vi.fn().mockResolvedValue(undefined),
      markComplete: vi.fn().mockResolvedValue(undefined),
      markRetry: vi.fn().mockResolvedValue(undefined),
      revokeCredentials: vi.fn().mockResolvedValue(undefined),
    },
    dathost: {
      getServer: vi.fn().mockResolvedValue(server),
      stopServer: vi.fn().mockResolvedValue(undefined),
      deleteServer: vi.fn().mockResolvedValue(undefined),
    },
    voice: { returnParticipantsToLobby: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('cleanup orchestrator', () => {
  it('revokes access, restores voice, stops and deletes the owned duplicate', async () => {
    const deps = dependencies();
    const orchestrator = new CleanupOrchestrator(
      deps.repository,
      deps.dathost,
      deps.voice,
      new Set(['template']),
    );
    await orchestrator.cleanup(resource);
    expect(deps.repository.revokeCredentials).toHaveBeenCalledWith('match');
    expect(deps.dathost.deleteServer).toHaveBeenCalledWith('duplicate');
    expect(deps.repository.markComplete).toHaveBeenCalledWith('match');
  });

  it('treats an already absent duplicate as successful idempotent cleanup', async () => {
    const deps = dependencies(null);
    await new CleanupOrchestrator(
      deps.repository,
      deps.dathost,
      deps.voice,
      new Set(['template']),
    ).cleanup(resource);
    expect(deps.dathost.deleteServer).not.toHaveBeenCalled();
    expect(deps.repository.markComplete).toHaveBeenCalled();
  });

  it('never targets a protected template', async () => {
    const deps = dependencies({ id: 'template' });
    await expect(
      new CleanupOrchestrator(
        deps.repository,
        deps.dathost,
        deps.voice,
        new Set(['template']),
      ).cleanup({ ...resource, serverId: 'template', ownedServerId: 'template' }),
    ).rejects.toThrow('Protected template');
    expect(deps.dathost.deleteServer).not.toHaveBeenCalled();
  });
});
