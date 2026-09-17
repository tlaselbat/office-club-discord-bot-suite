import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const rewardsMigration = new URL(
  '../../prisma/migrations/20260917120000_member_rewards/migration.sql',
  import.meta.url,
);
const receiptMigration = new URL(
  '../../prisma/migrations/20260917140000_reward_activity_receipts/migration.sql',
  import.meta.url,
);
const splitMigration = new URL(
  '../../prisma/migrations/20260917130000_split_suite_guild_settings/migration.sql',
  import.meta.url,
);

describe('member rewards migrations', () => {
  it('retains ledger, voice-session, and admin-reason database invariants', async () => {
    const sql = await readFile(rewardsMigration, 'utf8');
    expect(sql).toContain('reward_ledger_entries_guild_id_idempotency_key_key');
    expect(sql).toContain('reward_voice_sessions_one_active_member');
    expect(sql).toContain('reward_ledger_entries_admin_reason_check');
    expect(sql).toContain('reward_members_effective_xp_check');
  });

  it('persists accepted and cooldown-rejected activity delivery receipts', async () => {
    const sql = await readFile(receiptMigration, 'utf8');
    expect(sql).toContain('reward_activity_receipts_guild_id_idempotency_key_key');
    expect(sql).toContain('"accepted" BOOLEAN NOT NULL');
    expect(sql).toContain('REFERENCES "suite_guilds"');
  });

  it('backfills suite guilds before repointing module foreign keys', async () => {
    const sql = await readFile(splitMigration, 'utf8');
    const create = sql.indexOf('CREATE TABLE "suite_guilds"');
    const backfill = sql.indexOf(
      'SELECT "guild_id", "created_at", "updated_at" FROM "guild_settings"',
    );
    const foreignKey = sql.indexOf('guild_settings_suite_guild_id_fkey');
    expect(create).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(create);
    expect(foreignKey).toBeGreaterThan(backfill);
  });
});
