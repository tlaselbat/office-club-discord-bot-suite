CREATE TABLE "suite_guilds" (
    "guild_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "suite_guilds_pkey" PRIMARY KEY ("guild_id")
);

INSERT INTO "suite_guilds" ("guild_id", "created_at", "updated_at")
SELECT "guild_id", "created_at", "updated_at" FROM "guild_settings"
ON CONFLICT ("guild_id") DO NOTHING;

INSERT INTO "suite_guilds" ("guild_id", "created_at", "updated_at")
SELECT "guild_id", MIN("created_at"), MAX("updated_at") FROM "reward_settings" GROUP BY "guild_id"
ON CONFLICT ("guild_id") DO NOTHING;

ALTER TABLE "reward_settings" DROP CONSTRAINT "reward_settings_guild_id_fkey";
ALTER TABLE "reward_members" DROP CONSTRAINT "reward_members_guild_id_fkey";
ALTER TABLE "reward_levels" DROP CONSTRAINT "reward_levels_guild_id_fkey";
ALTER TABLE "reward_ledger_entries" DROP CONSTRAINT "reward_ledger_entries_guild_id_fkey";
ALTER TABLE "reward_voice_sessions" DROP CONSTRAINT "reward_voice_sessions_guild_id_fkey";

ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_suite_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_settings" ADD CONSTRAINT "reward_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_levels" ADD CONSTRAINT "reward_levels_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_voice_sessions" ADD CONSTRAINT "reward_voice_sessions_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
