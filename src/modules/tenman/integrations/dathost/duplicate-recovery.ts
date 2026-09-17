import type { DatHostServer } from './schemas.js';

export interface DuplicateAttemptEvidence {
  persistedServerId: string | null;
  ownershipMarker: string;
  provisionalName: string;
  location: string;
  requestStartedAt: Date;
  requestFinishedAt: Date;
  templateServerIds: ReadonlySet<string>;
}

export type DuplicateResolution =
  | {
      status: 'ADOPT';
      server: DatHostServer;
      evidence: 'PERSISTED_ID' | 'USER_DATA' | 'NAME_LOCATION_TIME';
    }
  | { status: 'PENDING' }
  | { status: 'AMBIGUOUS'; candidates: readonly DatHostServer[] };

export function reconcileDuplicate(
  attempt: DuplicateAttemptEvidence,
  servers: readonly DatHostServer[],
  windowMs = 120_000,
): DuplicateResolution {
  const safeServers = servers.filter((server) => !attempt.templateServerIds.has(server.id));
  if (attempt.persistedServerId !== null) {
    const persisted = safeServers.find((server) => server.id === attempt.persistedServerId);
    return persisted === undefined
      ? { status: 'PENDING' }
      : { status: 'ADOPT', server: persisted, evidence: 'PERSISTED_ID' };
  }
  const owned = safeServers.filter((server) => server.user_data === attempt.ownershipMarker);
  const singleOwned = owned.length === 1 ? owned[0] : undefined;
  if (singleOwned !== undefined)
    return { status: 'ADOPT', server: singleOwned, evidence: 'USER_DATA' };
  if (owned.length > 1) return { status: 'AMBIGUOUS', candidates: owned };

  const lower = attempt.requestStartedAt.getTime() - windowMs;
  const upper = attempt.requestFinishedAt.getTime() + windowMs;
  const correlated = safeServers.filter((server) => {
    const createdAt = server.created_at * 1000;
    return (
      server.name === attempt.provisionalName &&
      server.location === attempt.location &&
      createdAt >= lower &&
      createdAt <= upper
    );
  });
  const singleCorrelated = correlated.length === 1 ? correlated[0] : undefined;
  if (singleCorrelated !== undefined)
    return { status: 'ADOPT', server: singleCorrelated, evidence: 'NAME_LOCATION_TIME' };
  if (correlated.length > 1) return { status: 'AMBIGUOUS', candidates: correlated };
  return { status: 'PENDING' };
}

export function assertDeletionAllowed(
  serverId: string,
  ownedServerId: string,
  templateServerIds: ReadonlySet<string>,
): void {
  if (serverId !== ownedServerId) throw new Error('Server ownership is not proven');
  if (templateServerIds.has(serverId))
    throw new Error('Protected template server cannot be deleted');
}
