import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { Client } from 'pg';

const databaseUrls = new WeakMap<PrismaClient, string>();

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  databaseUrls.set(prisma, databaseUrl);
  return prisma;
}

/**
 * A dedicated session keeps Discord I/O outside Prisma transactions. Lock waiters
 * never consume the query pool needed by the lock owner, and failed operations
 * can persist their deployment intent/error before the session releases the lock.
 */
export async function withDatabaseAdvisoryLock<T>(
  prisma: PrismaClient,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const connectionString = databaseUrls.get(prisma);
  if (connectionString === undefined)
    throw new Error('Database lock requires a configured Prisma client.');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  // pg emits asynchronous connection failures separately from query failures.
  let connectionError: Error | undefined;
  client.on('error', (error: Error) => {
    connectionError = error;
  });
  let locked = false;
  try {
    await client.connect();
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
    locked = true;
    if (connectionError !== undefined) throw connectionError;
    const result = await operation();
    return result;
  } finally {
    if (locked && connectionError === undefined)
      await client
        .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key])
        .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
