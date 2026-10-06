CREATE TYPE "GameServerUpdateThreadType" AS ENUM ('ANNOUNCEMENTS', 'CHANGELOG');

CREATE TABLE "game_server_update_threads" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "game_server_id" UUID NOT NULL,
  "type" "GameServerUpdateThreadType" NOT NULL,
  "thread_id" TEXT NOT NULL,
  "parent_channel_id" TEXT NOT NULL,
  "latest_message_id" TEXT,
  "latest_message_text" TEXT,
  "latest_message_at" TIMESTAMP(3),
  "notification_started_at" TIMESTAMP(3),
  "notification_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_server_update_threads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_server_update_threads_game_server_id_type_key" ON "game_server_update_threads"("game_server_id", "type");
CREATE UNIQUE INDEX "game_server_update_threads_thread_id_key" ON "game_server_update_threads"("thread_id");
CREATE INDEX "game_server_update_threads_guild_id_idx" ON "game_server_update_threads"("guild_id");
CREATE INDEX "game_server_update_threads_game_server_id_idx" ON "game_server_update_threads"("game_server_id");
CREATE INDEX "game_server_update_threads_notification_expires_at_idx" ON "game_server_update_threads"("notification_expires_at");

ALTER TABLE "game_server_update_threads" ADD CONSTRAINT "game_server_update_threads_game_server_id_fkey" FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
