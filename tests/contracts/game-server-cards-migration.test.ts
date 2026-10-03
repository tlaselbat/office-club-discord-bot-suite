import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../prisma/migrations/20261003010000_game_server_cards/migration.sql',
  import.meta.url,
);

describe('Game Server Cards migration', () => {
  it('persists card registrations keyed to configured game servers', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('CREATE TABLE "game_server_cards"');
    expect(sql).toContain('"guild_id"');
    expect(sql).toContain('"game_server_id"');
    expect(sql).toContain('"channel_id"');
    expect(sql).toContain('"message_id"');
    expect(sql).toContain('"last_known_state"');
    expect(sql).toContain('"last_successful_poll_at"');
    expect(sql).toContain('"game_server_cards_game_server_id_key"');
    expect(sql).toContain('ON DELETE CASCADE');
  });
});
