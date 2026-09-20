import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../prisma/migrations/20260920000000_initial_schema/migration.sql',
  import.meta.url,
);

describe('member rewards schema', () => {
  it('retains ledger, voice-session, and admin-reason database invariants', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('reward_ledger_entries_guild_id_idempotency_key_key');
    expect(sql).toContain('reward_voice_sessions_one_active_member');
    expect(sql).toContain('reward_ledger_entries_admin_reason_check');
    expect(sql).toContain('reward_members_effective_xp_check');
  });

  it('persists accepted and cooldown-rejected activity delivery receipts', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('reward_activity_receipts_guild_id_idempotency_key_key');
    expect(sql).toContain('"accepted" BOOLEAN NOT NULL');
    expect(sql).toContain('REFERENCES "suite_guilds"');
  });

  it('connects module settings to suite guilds', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('CREATE TABLE "suite_guilds"');
    expect(sql).toContain('guild_settings_guild_id_fkey');
    expect(sql).toContain('REFERENCES "suite_guilds"');
  });
});
