import { assertDeletionAllowed } from '../integrations/dathost/duplicate-recovery.js';

export interface CleanupResource {
  matchId: string;
  serverId: string | null;
  ownedServerId: string | null;
  cleanupStatus: 'PENDING' | 'RUNNING' | 'RETRY' | 'FAILED';
}

export interface CleanupRepository {
  markRunning(matchId: string): Promise<void>;
  markComplete(matchId: string): Promise<void>;
  markRetry(matchId: string, reason: string): Promise<void>;
  revokeCredentials(matchId: string): Promise<void>;
}

export interface CleanupDatHost {
  getServer(serverId: string): Promise<{ id: string } | null>;
  stopServer(serverId: string): Promise<void>;
  deleteServer(serverId: string): Promise<void>;
}

export interface CleanupVoice {
  returnParticipantsToLobby(matchId: string): Promise<void>;
}

export class CleanupOrchestrator {
  public constructor(
    private readonly repository: CleanupRepository,
    private readonly dathost: CleanupDatHost,
    private readonly voice: CleanupVoice,
    private readonly templateServerIds: ReadonlySet<string>,
  ) {}

  public async cleanup(resource: CleanupResource): Promise<void> {
    await this.repository.markRunning(resource.matchId);
    await this.repository.revokeCredentials(resource.matchId);
    await this.voice.returnParticipantsToLobby(resource.matchId);
    if (resource.serverId === null || resource.ownedServerId === null) {
      await this.repository.markComplete(resource.matchId);
      return;
    }
    assertDeletionAllowed(resource.serverId, resource.ownedServerId, this.templateServerIds);
    try {
      const server = await this.dathost.getServer(resource.serverId);
      if (server === null) {
        await this.repository.markComplete(resource.matchId);
        return;
      }
      if (server.id !== resource.ownedServerId)
        throw new Error('DatHost identity changed during cleanup');
      await this.dathost.stopServer(server.id);
      await this.dathost.deleteServer(server.id);
      await this.repository.markComplete(resource.matchId);
    } catch (error: unknown) {
      await this.repository.markRetry(
        resource.matchId,
        error instanceof Error ? error.message : 'Unknown cleanup error',
      );
      throw error;
    }
  }
}
