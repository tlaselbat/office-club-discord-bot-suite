-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MatchState" AS ENUM ('CREATED', 'READY_CHECK', 'TEAM_SELECTION', 'MAP_VETO', 'TEAMS_LOCKED', 'SERVER_PROVISIONING', 'SERVER_BOOTING', 'SERVER_READY', 'MATCH_LOADED', 'WARMUP', 'LIVE', 'PAUSED', 'FINISHED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "TenManQueueStatus" AS ENUM ('OPEN', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MatchDiscordResourceType" AS ENUM ('MATCH_TEXT_CHANNEL', 'MATCH_DASHBOARD_MESSAGE');

-- CreateEnum
CREATE TYPE "MatchDiscordResourceState" AS ENUM ('PENDING_CREATE', 'CREATE_IN_FLIGHT', 'ACTIVE', 'PENDING_DELETE', 'DELETED');

-- CreateEnum
CREATE TYPE "CaptainPolicy" AS ENUM ('RANDOM', 'VOLUNTEER', 'HIGHEST_RATING', 'ADMIN_SELECTED');

-- CreateEnum
CREATE TYPE "TeamSelectionMode" AS ENUM ('RANDOM', 'CAPTAINS', 'BALANCED', 'ADMIN_ASSIGNED');

-- CreateEnum
CREATE TYPE "MapSelectionMode" AS ENUM ('CAPTAIN_VETO', 'RANDOM', 'ADMIN_SELECTED', 'PRESELECTED');

-- CreateEnum
CREATE TYPE "DraftTeam" AS ENUM ('TEAM_1', 'TEAM_2');

-- CreateEnum
CREATE TYPE "VetoAction" AS ENUM ('BAN', 'PICK', 'DECIDER');

-- CreateEnum
CREATE TYPE "MatchResultStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CleanupStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RUNNING', 'RETRY', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "PlayerTeam" AS ENUM ('UNASSIGNED', 'TEAM_1', 'TEAM_2', 'SPECTATOR');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('PLAYER', 'SPECTATOR');

-- CreateEnum
CREATE TYPE "ReadyState" AS ENUM ('NOT_READY', 'READY', 'WAITING_FOR_VOICE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('DUPLICATE_REQUEST_PENDING', 'DUPLICATE_OUTCOME_UNKNOWN', 'SERVER_IDENTIFIED', 'AMBIGUOUS', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "CredentialCapability" AS ENUM ('CONFIG_READ', 'EVENT_WRITE');

-- CreateEnum
CREATE TYPE "ManagedResourceState" AS ENUM ('NONE', 'SETTING_UP', 'ACTIVE', 'TEARING_DOWN');

-- CreateEnum
CREATE TYPE "ManagedSetupStep" AS ENUM ('RESERVED', 'CATEGORY_CREATE_IN_FLIGHT', 'CATEGORY_CREATED', 'LOBBY_TEXT_CREATE_IN_FLIGHT', 'LOBBY_TEXT_CREATED', 'LOBBY_VOICE_CREATE_IN_FLIGHT', 'LOBBY_VOICE_CREATED', 'TEAM1_VOICE_CREATE_IN_FLIGHT', 'TEAM1_VOICE_CREATED', 'TEAM2_VOICE_CREATE_IN_FLIGHT', 'TEAM2_VOICE_CREATED');

-- CreateEnum
CREATE TYPE "RewardSource" AS ENUM ('TEXT_ACTIVITY', 'VOICE_ACTIVITY', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardVoiceSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "users" (
    "discord_user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("discord_user_id")
);

-- CreateTable
CREATE TABLE "steam_identities" (
    "id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "steam_id_64" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "invalidated_at" TIMESTAMP(3),
    "invalidation_reason" TEXT,
    "provenance" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steam_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steam_link_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "expected_return_url" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steam_link_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suite_guilds" (
    "guild_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suite_guilds_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "guild_settings" (
    "guild_id" TEXT NOT NULL,
    "lobby_text_channel_id" TEXT,
    "lobby_voice_channel_id" TEXT,
    "team1_voice_channel_id" TEXT,
    "team2_voice_channel_id" TEXT,
    "privileged_role_ids" TEXT[],
    "moderator_role_ids" TEXT[],
    "administrator_role_ids" TEXT[],
    "dathost_template_server_id" TEXT,
    "default_server_location" TEXT,
    "default_game_profile_key" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "queue_size" INTEGER NOT NULL DEFAULT 10,
    "party_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ready_timeout_seconds" INTEGER NOT NULL DEFAULT 90,
    "captain_policy" "CaptainPolicy" NOT NULL DEFAULT 'RANDOM',
    "team_selection_mode" "TeamSelectionMode" NOT NULL DEFAULT 'CAPTAINS',
    "map_selection_mode" "MapSelectionMode" NOT NULL DEFAULT 'CAPTAIN_VETO',
    "managed_resource_state" "ManagedResourceState" NOT NULL DEFAULT 'NONE',
    "managed_setup_step" "ManagedSetupStep",
    "managed_attempt_id" UUID,
    "managed_category_id" TEXT,
    "managed_channel_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "managed_resources_created_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "reward_settings" (
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "text_xp_amount" INTEGER NOT NULL DEFAULT 10,
    "text_cooldown_seconds" INTEGER NOT NULL DEFAULT 60,
    "voice_xp_amount" INTEGER NOT NULL DEFAULT 5,
    "voice_interval_seconds" INTEGER NOT NULL DEFAULT 300,
    "text_channel_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voice_channel_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tag_required_seconds" INTEGER NOT NULL DEFAULT 2592000,
    "tag_reward_role_id" TEXT,
    "tag_reconcile_seconds" INTEGER NOT NULL DEFAULT 900,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "reward_members" (
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "effective_xp" INTEGER NOT NULL DEFAULT 0,
    "current_level" INTEGER NOT NULL DEFAULT 0,
    "last_text_award_at" TIMESTAMP(3),
    "tag_qualified_since" TIMESTAMP(3),
    "tag_last_checked_at" TIMESTAMP(3),
    "tag_role_granted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_members_pkey" PRIMARY KEY ("guild_id","discord_user_id")
);

-- CreateTable
CREATE TABLE "reward_levels" (
    "guild_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "xp_threshold" INTEGER NOT NULL,
    "label" TEXT,
    "role_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_levels_pkey" PRIMARY KEY ("guild_id","level")
);

-- CreateTable
CREATE TABLE "reward_ledger_entries" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" "RewardSource" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "actor_discord_user_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_activity_receipts" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "source" "RewardSource" NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_activity_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_voice_sessions" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "status" "RewardVoiceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connected_at" TIMESTAMP(3) NOT NULL,
    "checkpoint_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_profiles" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "players_per_team" INTEGER NOT NULL,
    "num_maps" INTEGER NOT NULL DEFAULT 1,
    "server_slots" INTEGER NOT NULL,
    "map_allowlist" TEXT[],
    "matchzy_options" JSONB NOT NULL,
    "allowed_cvars" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_profiles_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "leader_discord_user_id" TEXT NOT NULL,
    "state" "MatchState" NOT NULL DEFAULT 'CREATED',
    "phase_deadline_at" TIMESTAMP(3),
    "phase_generation" INTEGER NOT NULL DEFAULT 0,
    "cleanup_status" "CleanupStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "guild_slot_active" BOOLEAN NOT NULL DEFAULT true,
    "selected_map" TEXT,
    "selected_game_profile_key" TEXT NOT NULL,
    "dathost_server_id" TEXT,
    "dathost_ip" TEXT,
    "dathost_port" INTEGER,
    "encrypted_rcon_password" TEXT,
    "encrypted_join_password" TEXT,
    "matchzy_match_id" SERIAL NOT NULL,
    "matchzy_config" JSONB,
    "matchzy_config_hash" TEXT,
    "last_matchzy_event_at" TIMESTAMP(3),
    "result" JSONB,
    "result_status" "MatchResultStatus" NOT NULL DEFAULT 'PENDING',
    "score" JSONB,
    "failure_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "steam_id_64" TEXT NOT NULL,
    "display_name_snapshot" TEXT NOT NULL,
    "participant_role" "ParticipantRole" NOT NULL DEFAULT 'PLAYER',
    "team" "PlayerTeam" NOT NULL DEFAULT 'UNASSIGNED',
    "ready_state" "ReadyState" NOT NULL DEFAULT 'NOT_READY',
    "captain_team" "DraftTeam",
    "draft_order" INTEGER,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "tenman_parties" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "leader_discord_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenman_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenman_party_members" (
    "party_id" UUID NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenman_party_members_pkey" PRIMARY KEY ("party_id","discord_user_id")
);

-- CreateTable
CREATE TABLE "tenman_party_invites" (
    "id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "invitee_discord_user_id" TEXT NOT NULL,
    "inviter_discord_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenman_party_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "match_discord_resources" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "resource_type" "MatchDiscordResourceType" NOT NULL,
    "discord_id" TEXT,
    "created_by_bot" BOOLEAN NOT NULL DEFAULT false,
    "state" "MatchDiscordResourceState" NOT NULL DEFAULT 'PENDING_CREATE',
    "creation_attempt_id" TEXT,
    "creation_lease_expires_at" TIMESTAMP(3),
    "creation_io_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "match_discord_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "player_guild_stats" (
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_guild_stats_pkey" PRIMARY KEY ("guild_id","discord_user_id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "match_state_transitions" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "from_state" "MatchState" NOT NULL,
    "to_state" "MatchState" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "event_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_state_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleanup_transitions" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "from_status" "CleanupStatus" NOT NULL,
    "to_status" "CleanupStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleanup_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "match_id" UUID,
    "guild_id" TEXT NOT NULL,
    "actor_discord_user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_events" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3),
    "processing_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_events" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "observation" JSONB NOT NULL,
    "correction" JSONB,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisioning_attempts" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "status" "ProvisioningStatus" NOT NULL,
    "provisional_name" TEXT NOT NULL,
    "requested_template_id" TEXT NOT NULL,
    "requested_location" TEXT NOT NULL,
    "request_started_at" TIMESTAMP(3),
    "request_finished_at" TIMESTAMP(3),
    "dathost_server_id" TEXT,
    "candidate_evidence" JSONB,
    "operator_resolution" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provisioning_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "match_id" UUID,
    "type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_credentials" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "capability" "CredentialCapability" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "server_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_references" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "map_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reference" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steam_identities_discord_user_id_idx" ON "steam_identities"("discord_user_id");

-- CreateIndex
CREATE INDEX "steam_identities_steam_id_64_idx" ON "steam_identities"("steam_id_64");

-- CreateIndex
CREATE UNIQUE INDEX "steam_link_sessions_token_hash_key" ON "steam_link_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "steam_link_sessions_discord_user_id_expires_at_idx" ON "steam_link_sessions"("discord_user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_sessions_token_hash_key" ON "web_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "web_sessions_expires_at_idx" ON "web_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "reward_members_guild_id_effective_xp_idx" ON "reward_members"("guild_id", "effective_xp");

-- CreateIndex
CREATE UNIQUE INDEX "reward_levels_guild_id_xp_threshold_key" ON "reward_levels"("guild_id", "xp_threshold");

-- CreateIndex
CREATE INDEX "reward_ledger_entries_guild_id_discord_user_id_created_at_idx" ON "reward_ledger_entries"("guild_id", "discord_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reward_ledger_entries_guild_id_idempotency_key_key" ON "reward_ledger_entries"("guild_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "reward_activity_receipts_guild_id_created_at_idx" ON "reward_activity_receipts"("guild_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reward_activity_receipts_guild_id_idempotency_key_key" ON "reward_activity_receipts"("guild_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "reward_voice_sessions_guild_id_status_checkpoint_at_idx" ON "reward_voice_sessions"("guild_id", "status", "checkpoint_at");

-- CreateIndex
CREATE UNIQUE INDEX "matches_dathost_server_id_key" ON "matches"("dathost_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_matchzy_match_id_key" ON "matches"("matchzy_match_id");

-- CreateIndex
CREATE INDEX "matches_guild_id_state_idx" ON "matches"("guild_id", "state");

-- CreateIndex
CREATE INDEX "matches_state_last_matchzy_event_at_idx" ON "matches"("state", "last_matchzy_event_at");

-- CreateIndex
CREATE INDEX "match_players_match_id_team_idx" ON "match_players"("match_id", "team");

-- CreateIndex
CREATE UNIQUE INDEX "match_players_match_id_discord_user_id_key" ON "match_players"("match_id", "discord_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_players_match_id_steam_id_64_key" ON "match_players"("match_id", "steam_id_64");

-- CreateIndex
CREATE INDEX "tenman_queue_entries_guild_id_joined_at_idx" ON "tenman_queue_entries"("guild_id", "joined_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenman_queue_entries_guild_id_discord_user_id_key" ON "tenman_queue_entries"("guild_id", "discord_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenman_queue_entries_guild_id_steam_id_64_key" ON "tenman_queue_entries"("guild_id", "steam_id_64");

-- CreateIndex
CREATE INDEX "tenman_parties_guild_id_idx" ON "tenman_parties"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenman_party_members_discord_user_id_key" ON "tenman_party_members"("discord_user_id");

-- CreateIndex
CREATE INDEX "tenman_party_invites_party_id_invitee_discord_user_id_expir_idx" ON "tenman_party_invites"("party_id", "invitee_discord_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "tenman_party_invites_invitee_discord_user_id_expires_at_idx" ON "tenman_party_invites"("invitee_discord_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "tenman_queue_bans_guild_id_discord_user_id_expires_at_idx" ON "tenman_queue_bans"("guild_id", "discord_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "match_discord_resources_match_id_state_idx" ON "match_discord_resources"("match_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "match_discord_resources_match_id_resource_type_key" ON "match_discord_resources"("match_id", "resource_type");

-- CreateIndex
CREATE UNIQUE INDEX "match_draft_picks_match_id_pick_number_key" ON "match_draft_picks"("match_id", "pick_number");

-- CreateIndex
CREATE UNIQUE INDEX "match_draft_picks_match_id_selected_discord_user_id_key" ON "match_draft_picks"("match_id", "selected_discord_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_veto_actions_match_id_sequence_key" ON "match_veto_actions"("match_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "match_veto_actions_match_id_map_name_key" ON "match_veto_actions"("match_id", "map_name");

-- CreateIndex
CREATE INDEX "player_guild_stats_guild_id_rating_idx" ON "player_guild_stats"("guild_id", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "match_rating_changes_match_id_discord_user_id_key" ON "match_rating_changes"("match_id", "discord_user_id");

-- CreateIndex
CREATE INDEX "match_state_transitions_match_id_created_at_idx" ON "match_state_transitions"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "cleanup_transitions_match_id_created_at_idx" ON "cleanup_transitions"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_guild_id_created_at_idx" ON "audit_events"("guild_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_match_id_created_at_idx" ON "audit_events"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "external_events_match_id_created_at_idx" ON "external_events"("match_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "external_events_match_id_provider_dedupe_key_key" ON "external_events"("match_id", "provider", "dedupe_key");

-- CreateIndex
CREATE INDEX "reconciliation_events_match_id_created_at_idx" ON "reconciliation_events"("match_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provisioning_attempts_provisional_name_key" ON "provisioning_attempts"("provisional_name");

-- CreateIndex
CREATE INDEX "provisioning_attempts_match_id_status_idx" ON "provisioning_attempts"("match_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_credentials_token_hash_key" ON "match_credentials"("token_hash");

-- CreateIndex
CREATE INDEX "match_credentials_match_id_capability_expires_at_idx" ON "match_credentials"("match_id", "capability", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_credentials_match_id_capability_version_key" ON "match_credentials"("match_id", "capability", "version");

-- CreateIndex
CREATE INDEX "demo_references_match_id_map_name_idx" ON "demo_references"("match_id", "map_name");

-- AddForeignKey
ALTER TABLE "steam_identities" ADD CONSTRAINT "steam_identities_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_settings" ADD CONSTRAINT "reward_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_levels" ADD CONSTRAINT "reward_levels_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_guild_id_discord_user_id_fkey" FOREIGN KEY ("guild_id", "discord_user_id") REFERENCES "reward_members"("guild_id", "discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_activity_receipts" ADD CONSTRAINT "reward_activity_receipts_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_voice_sessions" ADD CONSTRAINT "reward_voice_sessions_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_voice_sessions" ADD CONSTRAINT "reward_voice_sessions_guild_id_discord_user_id_fkey" FOREIGN KEY ("guild_id", "discord_user_id") REFERENCES "reward_members"("guild_id", "discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_selected_game_profile_key_fkey" FOREIGN KEY ("selected_game_profile_key") REFERENCES "game_profiles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_queues" ADD CONSTRAINT "tenman_queues_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_queue_entries" ADD CONSTRAINT "tenman_queue_entries_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "tenman_queues"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_queue_entries" ADD CONSTRAINT "tenman_queue_entries_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_queue_entries" ADD CONSTRAINT "tenman_queue_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_parties" ADD CONSTRAINT "tenman_parties_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_party_members" ADD CONSTRAINT "tenman_party_members_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_party_members" ADD CONSTRAINT "tenman_party_members_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_party_invites" ADD CONSTRAINT "tenman_party_invites_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_party_invites" ADD CONSTRAINT "tenman_party_invites_invitee_discord_user_id_fkey" FOREIGN KEY ("invitee_discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenman_queue_bans" ADD CONSTRAINT "tenman_queue_bans_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_discord_resources" ADD CONSTRAINT "match_discord_resources_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_draft_picks" ADD CONSTRAINT "match_draft_picks_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_veto_actions" ADD CONSTRAINT "match_veto_actions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_guild_stats" ADD CONSTRAINT "player_guild_stats_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_guild_stats" ADD CONSTRAINT "player_guild_stats_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rating_changes" ADD CONSTRAINT "match_rating_changes_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_state_transitions" ADD CONSTRAINT "match_state_transitions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanup_transitions" ADD CONSTRAINT "cleanup_transitions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_events" ADD CONSTRAINT "reconciliation_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisioning_attempts" ADD CONSTRAINT "provisioning_attempts_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_credentials" ADD CONSTRAINT "match_credentials_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_references" ADD CONSTRAINT "demo_references_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve partial indexes and checks that are not expressible in the Prisma schema.
CREATE UNIQUE INDEX "steam_identities_active_discord_user_id_key"
ON "steam_identities"("discord_user_id") WHERE "invalidated_at" IS NULL;
CREATE UNIQUE INDEX "steam_identities_active_steam_id_64_key"
ON "steam_identities"("steam_id_64") WHERE "invalidated_at" IS NULL;
ALTER TABLE "steam_identities"
ADD CONSTRAINT "steam_identities_steam_id_64_format_check"
CHECK ("steam_id_64" ~ '^7656119[0-9]{10}$');

CREATE UNIQUE INDEX "matches_one_active_slot_per_guild"
ON "matches"("guild_id") WHERE "guild_slot_active" = true;

-- Preserve database-level rewards invariants that are not expressible in the Prisma schema.
ALTER TABLE "reward_settings" ADD CONSTRAINT "reward_settings_values_check" CHECK (
    "text_xp_amount" > 0 AND "text_cooldown_seconds" > 0 AND
    "voice_xp_amount" > 0 AND "voice_interval_seconds" > 0 AND
    "tag_required_seconds" > 0 AND "tag_reconcile_seconds" >= 60
);
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_effective_xp_check" CHECK ("effective_xp" >= 0);
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_current_level_check" CHECK ("current_level" >= 0);
ALTER TABLE "reward_levels" ADD CONSTRAINT "reward_levels_values_check" CHECK ("level" >= 0 AND "xp_threshold" >= 0);
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_admin_reason_check" CHECK (
    "source" <> 'ADMIN_ADJUSTMENT' OR
    ("actor_discord_user_id" IS NOT NULL AND length(trim("reason")) > 0)
);
ALTER TABLE "reward_voice_sessions" ADD CONSTRAINT "reward_voice_sessions_dates_check" CHECK (
    "checkpoint_at" >= "connected_at" AND
    (("status" = 'ACTIVE' AND "closed_at" IS NULL) OR
     ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_at" >= "connected_at"))
);
CREATE UNIQUE INDEX "reward_voice_sessions_one_active_member" ON "reward_voice_sessions"("guild_id", "discord_user_id") WHERE "status" = 'ACTIVE';

