 WARN  Unsupported engine: wanted: {"node":">=22.0.0"} (current: {"node":"v20.19.4","pnpm":"10.15.1"})
CREATE TYPE "TenManWorkflowVersion" AS ENUM ('V1', 'V2');
CREATE TYPE "TenManQueueStatus" AS ENUM ('OPEN', 'LOCKED', 'DISABLED');
CREATE TYPE "MatchDiscordResourceType" AS ENUM ('MATCH_TEXT_CHANNEL', 'MATCH_DASHBOARD_MESSAGE');
CREATE TYPE "MatchDiscordResourceState" AS ENUM ('PENDING_CREATE', 'CREATE_IN_FLIGHT', 'ACTIVE', 'PENDING_DELETE', 'DELETED');
CREATE TYPE "CaptainPolicy" AS ENUM ('RANDOM', 'VOLUNTEER', 'HIGHEST_RATING', 'ADMIN_SELECTED');
CREATE TYPE "TeamSelectionMode" AS ENUM ('RANDOM', 'CAPTAINS', 'BALANCED', 'ADMIN_ASSIGNED');
CREATE TYPE "MapSelectionMode" AS ENUM ('CAPTAIN_VETO', 'RANDOM', 'ADMIN_SELECTED', 'PRESELECTED');
CREATE TYPE "DraftTeam" AS ENUM ('TEAM_1', 'TEAM_2');
CREATE TYPE "VetoAction" AS ENUM ('BAN', 'PICK', 'DECIDER');
CREATE TYPE "MatchResultStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED');

ALTER TYPE "MatchState" ADD VALUE IF NOT EXISTS 'READY_CHECK' BEFORE 'OPEN';
ALTER TYPE "MatchState" ADD VALUE IF NOT EXISTS 'TEAM_SELECTION' BEFORE 'OPEN';
ALTER TYPE "MatchState" ADD VALUE IF NOT EXISTS 'MAP_VETO' BEFORE 'OPEN';

ALTER TABLE "guild_settings"
  ADD COLUMN "v2_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "queue_size" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "registration_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "party_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ready_timeout_seconds" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "captain_policy" "CaptainPolicy" NOT NULL DEFAULT 'RANDOM',
  ADD COLUMN "team_selection_mode" "TeamSelectionMode" NOT NULL DEFAULT 'CAPTAINS',
  ADD COLUMN "map_selection_mode" "MapSelectionMode" NOT NULL DEFAULT 'CAPTAIN_VETO';

ALTER TABLE "matches"
  ADD COLUMN "workflow_version" "TenManWorkflowVersion" NOT NULL DEFAULT 'V1',
  ADD COLUMN "phase_deadline_at" TIMESTAMP(3),
  ADD COLUMN "phase_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "result_status" "MatchResultStatus" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "match_players"
  ADD COLUMN "captain_team" "DraftTeam",
  ADD COLUMN "draft_order" INTEGER;

CREATE TABLE "tenman_queues" (
  "guild_id" TEXT NOT NULL,
  "status" "TenManQueueStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 0,
  "panel_channel_id" TEXT,
  "panel_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenman_queues_pkey" PRIMARY KEY ("guild_id")
);

CREATE TABLE "tenman_queue_entries" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "steam_id_64" TEXT NOT NULL,
  "display_name_snapshot" TEXT NOT NULL,
  "party_id" UUID,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenman_queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenman_parties" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "leader_discord_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenman_parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenman_party_members" (
  "party_id" UUID NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenman_party_members_pkey" PRIMARY KEY ("party_id", "discord_user_id")
);

CREATE TABLE "tenman_queue_bans" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actor_discord_user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenman_queue_bans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_discord_resources" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "resource_type" "MatchDiscordResourceType" NOT NULL,
  "discord_id" TEXT,
  "created_by_bot" BOOLEAN NOT NULL DEFAULT false,
  "state" "MatchDiscordResourceState" NOT NULL DEFAULT 'PENDING_CREATE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "match_discord_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_draft_picks" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "pick_number" INTEGER NOT NULL,
  "captain_discord_user_id" TEXT NOT NULL,
  "selected_discord_user_id" TEXT NOT NULL,
  "team" "DraftTeam" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_draft_picks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_veto_actions" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "actor_team" "DraftTeam" NOT NULL,
  "action" "VetoAction" NOT NULL,
  "map_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_veto_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_guild_stats" (
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1000,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "matches_played" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "player_guild_stats_pkey" PRIMARY KEY ("guild_id", "discord_user_id")
);

CREATE TABLE "match_rating_changes" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "rating_before" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "rating_after" INTEGER NOT NULL,
  "reversed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_rating_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenman_queue_entries_guild_id_discord_user_id_key" ON "tenman_queue_entries"("guild_id", "discord_user_id");
CREATE UNIQUE INDEX "tenman_queue_entries_guild_id_steam_id_64_key" ON "tenman_queue_entries"("guild_id", "steam_id_64");
CREATE INDEX "tenman_queue_entries_guild_id_joined_at_idx" ON "tenman_queue_entries"("guild_id", "joined_at");
CREATE INDEX "tenman_parties_guild_id_idx" ON "tenman_parties"("guild_id");
CREATE UNIQUE INDEX "tenman_party_members_discord_user_id_key" ON "tenman_party_members"("discord_user_id");
CREATE INDEX "tenman_queue_bans_guild_id_discord_user_id_expires_at_idx" ON "tenman_queue_bans"("guild_id", "discord_user_id", "expires_at");
CREATE UNIQUE INDEX "match_discord_resources_match_id_resource_type_key" ON "match_discord_resources"("match_id", "resource_type");
CREATE INDEX "match_discord_resources_match_id_state_idx" ON "match_discord_resources"("match_id", "state");
CREATE UNIQUE INDEX "match_draft_picks_match_id_pick_number_key" ON "match_draft_picks"("match_id", "pick_number");
CREATE UNIQUE INDEX "match_draft_picks_match_id_selected_discord_user_id_key" ON "match_draft_picks"("match_id", "selected_discord_user_id");
CREATE UNIQUE INDEX "match_veto_actions_match_id_sequence_key" ON "match_veto_actions"("match_id", "sequence");
CREATE UNIQUE INDEX "match_veto_actions_match_id_map_name_key" ON "match_veto_actions"("match_id", "map_name");
CREATE INDEX "player_guild_stats_guild_id_rating_idx" ON "player_guild_stats"("guild_id", "rating");
CREATE UNIQUE INDEX "match_rating_changes_match_id_discord_user_id_key" ON "match_rating_changes"("match_id", "discord_user_id");

ALTER TABLE "tenman_queues" ADD CONSTRAINT "tenman_queues_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenman_queue_entries" ADD CONSTRAINT "tenman_queue_entries_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "tenman_queues"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenman_queue_entries" ADD CONSTRAINT "tenman_queue_entries_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenman_queue_entries" ADD CONSTRAINT "tenman_queue_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenman_parties" ADD CONSTRAINT "tenman_parties_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenman_party_members" ADD CONSTRAINT "tenman_party_members_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenman_party_members" ADD CONSTRAINT "tenman_party_members_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenman_queue_bans" ADD CONSTRAINT "tenman_queue_bans_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_discord_resources" ADD CONSTRAINT "match_discord_resources_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_draft_picks" ADD CONSTRAINT "match_draft_picks_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_veto_actions" ADD CONSTRAINT "match_veto_actions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_guild_stats" ADD CONSTRAINT "player_guild_stats_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_guild_stats" ADD CONSTRAINT "player_guild_stats_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "match_rating_changes" ADD CONSTRAINT "match_rating_changes_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
