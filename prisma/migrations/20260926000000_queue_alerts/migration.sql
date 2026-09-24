-- Add queue alert tracking and per-player notification preferences

ALTER TABLE "tenman_queues" ADD COLUMN "last_queue_alert_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "tenman_notification_preferences" (
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "queue_alert" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenman_notification_preferences_pkey" PRIMARY KEY ("guild_id", "discord_user_id")
);

CREATE INDEX "tenman_notification_preferences_guild_id_queue_alert_idx" ON "tenman_notification_preferences"("guild_id", "queue_alert");
