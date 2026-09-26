-- Persist the staff control surface and individual Steam-eligible match moderators.
ALTER TYPE "ManagedSetupStep" ADD VALUE IF NOT EXISTS 'ADMIN_TEXT_CREATE_IN_FLIGHT';
ALTER TYPE "ManagedSetupStep" ADD VALUE IF NOT EXISTS 'ADMIN_TEXT_CREATED';

ALTER TABLE "guild_settings"
  ADD COLUMN IF NOT EXISTS "admin_channel_id" TEXT;

ALTER TABLE "guild_settings"
  ADD COLUMN IF NOT EXISTS "admin_panel_message_id" TEXT;

ALTER TABLE "tenman_queues"
  ADD COLUMN IF NOT EXISTS "enrollment_opened_at" TIMESTAMP(3);

-- Existing queues retain their current state. New queues are closed until staff opens enrollment.
ALTER TABLE "tenman_queues"
  ALTER COLUMN "status" SET DEFAULT 'DISABLED';

-- Capture every match-semantic setting at queue promotion. Existing matches
-- are backfilled from their then-current guild/profile configuration so that
-- post-deploy configuration edits cannot change an in-flight match.
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "settings_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "ready_timeout_seconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "captain_policy" "CaptainPolicy",
  ADD COLUMN IF NOT EXISTS "team_selection_mode" "TeamSelectionMode",
  ADD COLUMN IF NOT EXISTS "map_selection_mode" "MapSelectionMode",
  ADD COLUMN IF NOT EXISTS "dathost_template_server_id" TEXT,
  ADD COLUMN IF NOT EXISTS "server_location" TEXT,
  ADD COLUMN IF NOT EXISTS "map_allowlist" TEXT[];

UPDATE "matches" AS "match"
SET
  "settings_version" = "settings"."version",
  "ready_timeout_seconds" = "settings"."ready_timeout_seconds",
  "captain_policy" = "settings"."captain_policy",
  "team_selection_mode" = "settings"."team_selection_mode",
  "map_selection_mode" = "settings"."map_selection_mode",
  "dathost_template_server_id" = "settings"."dathost_template_server_id",
  "server_location" = COALESCE("settings"."default_server_location", 'dallas'),
  "map_allowlist" = "profile"."map_allowlist"
FROM "guild_settings" AS "settings", "game_profiles" AS "profile"
WHERE "settings"."guild_id" = "match"."guild_id"
  AND "profile"."key" = "match"."selected_game_profile_key"
  AND "match"."settings_version" IS NULL;

ALTER TABLE "matches"
  ALTER COLUMN "settings_version" SET NOT NULL,
  ALTER COLUMN "ready_timeout_seconds" SET NOT NULL,
  ALTER COLUMN "captain_policy" SET NOT NULL,
  ALTER COLUMN "team_selection_mode" SET NOT NULL,
  ALTER COLUMN "map_selection_mode" SET NOT NULL,
  ALTER COLUMN "server_location" SET NOT NULL,
  ALTER COLUMN "map_allowlist" SET NOT NULL;

DO $$ BEGIN
  CREATE TYPE "MatchModeratorStatus" AS ENUM ('ACTIVE', 'SUSPENDED_STEAM_INVALID');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "match_moderators" (
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "status" "MatchModeratorStatus" NOT NULL DEFAULT 'ACTIVE',
  "added_by_discord_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "match_moderators_pkey" PRIMARY KEY ("guild_id", "discord_user_id")
);

CREATE INDEX IF NOT EXISTS "match_moderators_guild_id_status_idx"
  ON "match_moderators" ("guild_id", "status");

ALTER TABLE "match_moderators"
  ADD CONSTRAINT "match_moderators_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "match_moderators"
  ADD CONSTRAINT "match_moderators_discord_user_id_fkey"
  FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
