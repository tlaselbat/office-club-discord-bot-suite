CREATE TYPE "RewardSource" AS ENUM ('TEXT_ACTIVITY', 'VOICE_ACTIVITY', 'ADMIN_ADJUSTMENT');
CREATE TYPE "RewardVoiceSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

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
    CONSTRAINT "reward_settings_pkey" PRIMARY KEY ("guild_id"),
    CONSTRAINT "reward_settings_values_check" CHECK (
        "text_xp_amount" > 0 AND "text_cooldown_seconds" > 0 AND
        "voice_xp_amount" > 0 AND "voice_interval_seconds" > 0 AND
        "tag_required_seconds" > 0 AND "tag_reconcile_seconds" >= 60
    )
);

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
    CONSTRAINT "reward_members_pkey" PRIMARY KEY ("guild_id", "discord_user_id"),
    CONSTRAINT "reward_members_effective_xp_check" CHECK ("effective_xp" >= 0),
    CONSTRAINT "reward_members_current_level_check" CHECK ("current_level" >= 0)
);

CREATE TABLE "reward_levels" (
    "guild_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "xp_threshold" INTEGER NOT NULL,
    "label" TEXT,
    "role_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reward_levels_pkey" PRIMARY KEY ("guild_id", "level"),
    CONSTRAINT "reward_levels_values_check" CHECK ("level" >= 0 AND "xp_threshold" >= 0)
);

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
    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_ledger_entries_amount_check" CHECK ("amount" <> 0),
    CONSTRAINT "reward_ledger_entries_admin_reason_check" CHECK (
        "source" <> 'ADMIN_ADJUSTMENT' OR
        ("actor_discord_user_id" IS NOT NULL AND length(trim("reason")) > 0)
    )
);

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
    CONSTRAINT "reward_voice_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_voice_sessions_dates_check" CHECK (
        "checkpoint_at" >= "connected_at" AND
        (("status" = 'ACTIVE' AND "closed_at" IS NULL) OR
         ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_at" >= "connected_at"))
    )
);

CREATE UNIQUE INDEX "reward_levels_guild_id_xp_threshold_key" ON "reward_levels"("guild_id", "xp_threshold");
CREATE INDEX "reward_members_guild_id_effective_xp_idx" ON "reward_members"("guild_id", "effective_xp");
CREATE UNIQUE INDEX "reward_ledger_entries_guild_id_idempotency_key_key" ON "reward_ledger_entries"("guild_id", "idempotency_key");
CREATE INDEX "reward_ledger_entries_guild_id_discord_user_id_created_at_idx" ON "reward_ledger_entries"("guild_id", "discord_user_id", "created_at");
CREATE INDEX "reward_voice_sessions_guild_id_status_checkpoint_at_idx" ON "reward_voice_sessions"("guild_id", "status", "checkpoint_at");
CREATE UNIQUE INDEX "reward_voice_sessions_one_active_member" ON "reward_voice_sessions"("guild_id", "discord_user_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "reward_settings" ADD CONSTRAINT "reward_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_discord_user_id_fkey" FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_levels" ADD CONSTRAINT "reward_levels_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_guild_id_discord_user_id_fkey" FOREIGN KEY ("guild_id", "discord_user_id") REFERENCES "reward_members"("guild_id", "discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_voice_sessions" ADD CONSTRAINT "reward_voice_sessions_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_voice_sessions" ADD CONSTRAINT "reward_voice_sessions_guild_id_discord_user_id_fkey" FOREIGN KEY ("guild_id", "discord_user_id") REFERENCES "reward_members"("guild_id", "discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
