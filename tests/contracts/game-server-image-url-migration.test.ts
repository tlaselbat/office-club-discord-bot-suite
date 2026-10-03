import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../prisma/migrations/20261003020000_game_server_image_url/migration.sql',
  import.meta.url,
);

describe('Game Server image_url migration', () => {
  it('adds an optional image_url column to game_servers', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('ALTER TABLE "game_servers"');
    expect(sql).toContain('"image_url"');
  });
});
