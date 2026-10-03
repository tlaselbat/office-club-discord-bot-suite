import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../prisma/migrations/20261003000000_game_servers_dathost_v1/migration.sql',
  import.meta.url,
);

describe('Game Servers migration', () => {
  it('persists registrations and normalized snapshots with per-guild provider uniqueness', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('CREATE TABLE "game_servers"');
    expect(sql).toContain('CREATE TABLE "game_server_snapshots"');
    expect(sql).toContain('"game_servers_guild_id_provider_provider_server_id_key"');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('does not persist DatHost credentials', async () => {
    const sql = (await readFile(migration, 'utf8')).toLowerCase();
    expect(sql).not.toContain('dathost_password');
    expect(sql).not.toContain('dathost_email');
  });
});
