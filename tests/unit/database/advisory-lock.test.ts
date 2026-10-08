import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Pg from 'pg';

const session = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
}));
vi.mock('pg', async (importOriginal) => {
  const original = await importOriginal<typeof Pg>();
  return {
    ...original,
    Client: class {
      connect = session.connect;
      query = session.query;
      end = session.end;
      on = session.on;
    },
  };
});
import { createPrismaClient, withDatabaseAdvisoryLock } from '../../../src/database/prisma.js';

afterEach(() => {
  vi.resetAllMocks();
});
beforeEach(() => {
  session.connect.mockResolvedValue(undefined);
  session.end.mockResolvedValue(undefined);
});

describe('dedicated database advisory session', () => {
  it('locks before side effects and releases its dedicated session', async () => {
    session.query.mockResolvedValue({});
    const prisma = createPrismaClient('postgresql://unused:unused@localhost:5432/unused');
    const operation = vi.fn(async () => {
      expect(session.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_lock(hashtextextended($1, 0))',
        ['game-server-card:server-1'],
      );
      return 'result';
    });
    expect(await withDatabaseAdvisoryLock(prisma, 'game-server-card:server-1', operation)).toBe(
      'result',
    );
    expect(session.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
      ['game-server-card:server-1'],
    );
    expect(session.end).toHaveBeenCalledOnce();
    await prisma.$disconnect();
  });

  it('closes the session after a failed operation even when unlock fails', async () => {
    session.query.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('unlock failed'));
    const prisma = createPrismaClient('postgresql://unused:unused@localhost:5432/unused');
    await expect(
      withDatabaseAdvisoryLock(prisma, 'server-1', async () => {
        throw new Error('Discord unavailable');
      }),
    ).rejects.toThrow('Discord unavailable');
    expect(session.end).toHaveBeenCalledOnce();
    await prisma.$disconnect();
  });

  it('never runs side effects after lock acquisition failure', async () => {
    session.query.mockRejectedValue(new Error('database unavailable'));
    const prisma = createPrismaClient('postgresql://unused:unused@localhost:5432/unused');
    const operation = vi.fn();
    await expect(withDatabaseAdvisoryLock(prisma, 'server-1', operation)).rejects.toThrow(
      'database unavailable',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(session.end).toHaveBeenCalledOnce();
    await prisma.$disconnect();
  });
});
