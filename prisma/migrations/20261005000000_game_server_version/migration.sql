-- Add optimistic-concurrency version columns to Game Server settings and registrations.

ALTER TABLE "game_server_settings"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "game_servers"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
