import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('managed update migration', () => {
  it('adds only the thread enum/table with identity constraints, expiry index, and cascading server relation', () => {
    const sql = readFileSync(
      new URL(
        '../../prisma/migrations/20261003030000_game_server_update_threads/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toContain('CREATE TYPE "GameServerUpdateThreadType"');
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sql).toContain('"game_server_id", "type"');
    expect(sql).toContain('CREATE UNIQUE INDEX "game_server_update_threads_thread_id_key"');
    expect(sql).toContain('"notification_expires_at"');
    expect(sql).toContain('REFERENCES "game_servers"("id") ON DELETE CASCADE');
    expect(sql).not.toMatch(/DROP|TRUNCATE|DELETE FROM/);
  });
});
