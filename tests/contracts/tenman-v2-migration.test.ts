import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../prisma/migrations/20260917150000_tenman_v2_foundation/migration.sql',
  import.meta.url,
);
const resourceLeaseMigration = new URL(
  '../../prisma/migrations/20260917190000_match_discord_resource_creation_lease/migration.sql',
  import.meta.url,
);
const v2OnlyMigration = new URL(
  '../../prisma/migrations/20260917200000_tenman_v2_only/migration.sql',
  import.meta.url,
);

describe('10man V2 migration contract', () => {
  it('adds durable queue and forming-match invariants', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('tenman_queue_entries_guild_id_discord_user_id_key');
    expect(sql).toContain('tenman_queue_entries_guild_id_steam_id_64_key');
    expect(sql).toContain('match_draft_picks_match_id_selected_discord_user_id_key');
    expect(sql).toContain('match_veto_actions_match_id_map_name_key');
  });

  it('removes all V1-only state and feature-flag schema after refusing legacy data', async () => {
    const sql = await readFile(v2OnlyMigration, 'utf8');
    expect(sql).toContain('V2-only migration refused');
    expect(sql).toContain("'OPEN', 'FULL', 'TEAM_SETUP'");
    expect(sql).toContain('DROP COLUMN "workflow_version"');
    expect(sql).toContain('DROP COLUMN "v2_enabled"');
    expect(sql).toContain('DROP TYPE "TenManWorkflowVersion"');
  });

  it('records only explicit match-resource ownership and avoids extension-specific UUID defaults', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('CREATE TABLE "match_discord_resources"');
    expect(sql).toContain('"created_by_bot" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE_IN_FLIGHT');
    expect(sql).not.toContain('gen_random_uuid');
  });

  it('persists a creation lease and an explicit pre-I/O versus post-I/O boundary', async () => {
    const sql = await readFile(resourceLeaseMigration, 'utf8');
    expect(sql).toContain('"creation_attempt_id" TEXT');
    expect(sql).toContain('"creation_lease_expires_at" TIMESTAMP(3)');
    expect(sql).toContain('"creation_io_started_at" TIMESTAMP(3)');
  });
});
