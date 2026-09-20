import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../prisma/migrations/20260920000000_initial_schema/migration.sql',
  import.meta.url,
);

describe('initial schema migration contract', () => {
  it('preserves active identity ownership and guild-slot partial indexes', async () => {
    const sql = (await readFile(migration, 'utf8')).replace(/\s+/g, ' ');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "steam_identities_active_discord_user_id_key" ON "steam_identities"("discord_user_id") WHERE "invalidated_at" IS NULL;',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "steam_identities_active_steam_id_64_key" ON "steam_identities"("steam_id_64") WHERE "invalidated_at" IS NULL;',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "matches_one_active_slot_per_guild" ON "matches"("guild_id") WHERE "guild_slot_active" = true;',
    );
    expect(sql).toContain('ADD CONSTRAINT "steam_identities_steam_id_64_format_check"');
    expect(sql).toContain(`CHECK ("steam_id_64" ~ '^7656119[0-9]{10}$');`);
  });

  it('creates durable queue and forming-match invariants', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('tenman_queue_entries_guild_id_discord_user_id_key');
    expect(sql).toContain('tenman_queue_entries_guild_id_steam_id_64_key');
    expect(sql).toContain('match_draft_picks_match_id_selected_discord_user_id_key');
    expect(sql).toContain('match_veto_actions_match_id_map_name_key');
  });

  it('is executable SQL from its first byte', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toMatch(/^-- CreateSchema/);
    expect(sql).not.toContain('Unsupported engine');
  });

  it('records only explicit match-resource ownership and avoids extension-specific UUID defaults', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('CREATE TABLE "match_discord_resources"');
    expect(sql).toContain('"created_by_bot" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE_IN_FLIGHT');
    expect(sql).not.toContain('gen_random_uuid');
  });

  it('persists a creation lease and an explicit pre-I/O versus post-I/O boundary', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('"creation_attempt_id" TEXT');
    expect(sql).toContain('"creation_lease_expires_at" TIMESTAMP(3)');
    expect(sql).toContain('"creation_io_started_at" TIMESTAMP(3)');
  });
});
