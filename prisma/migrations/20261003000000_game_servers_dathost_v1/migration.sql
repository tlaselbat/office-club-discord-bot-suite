CREATE TYPE "GameServerProvider" AS ENUM ('DATHOST');
CREATE TYPE "GameServerHostingState" AS ENUM ('STOPPED', 'STARTING', 'RUNNING', 'UNKNOWN');
CREATE TYPE "GameServerGameplayState" AS ENUM ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN');
CREATE TYPE "GameServerPlayerCountSource" AS ENUM ('DATHOST_MONITORING', 'DATHOST_SERVER_OBJECT', 'CACHE');

CREATE TABLE "game_server_settings" (
  "guild_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "panel_channel_id" TEXT,
  "panel_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_server_settings_pkey" PRIMARY KEY ("guild_id")
);

CREATE TABLE "game_servers" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "provider" "GameServerProvider" NOT NULL DEFAULT 'DATHOST',
  "provider_server_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "public" BOOLEAN NOT NULL DEFAULT true,
  "connect_domain" TEXT,
  "join_url" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_servers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_server_snapshots" (
  "game_server_id" UUID NOT NULL,
  "hosting_state" "GameServerHostingState" NOT NULL DEFAULT 'UNKNOWN',
  "gameplay_state" "GameServerGameplayState" NOT NULL DEFAULT 'UNKNOWN',
  "host" TEXT,
  "raw_ip" TEXT,
  "port" INTEGER,
  "datacenter" TEXT,
  "hostname" TEXT,
  "map" TEXT,
  "players" INTEGER,
  "max_players" INTEGER,
  "player_count_source" "GameServerPlayerCountSource",
  "cpu_percent" DOUBLE PRECISION,
  "memory_usage_mb" DOUBLE PRECISION,
  "average_ping_ms" DOUBLE PRECISION,
  "packet_loss_percent" DOUBLE PRECISION,
  "server_var_ms" DOUBLE PRECISION,
  "connected_steam_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "server_source" BOOLEAN NOT NULL DEFAULT false,
  "monitoring_source" BOOLEAN NOT NULL DEFAULT false,
  "console_source" BOOLEAN NOT NULL DEFAULT false,
  "server_observed_at" TIMESTAMP(3),
  "monitoring_observed_at" TIMESTAMP(3),
  "observed_at" TIMESTAMP(3) NOT NULL,
  "last_successful_at" TIMESTAMP(3),
  "last_online_at" TIMESTAMP(3),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "stale" BOOLEAN NOT NULL DEFAULT false,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_server_snapshots_pkey" PRIMARY KEY ("game_server_id")
);

CREATE UNIQUE INDEX "game_servers_guild_id_provider_provider_server_id_key" ON "game_servers"("guild_id", "provider", "provider_server_id");
CREATE INDEX "game_servers_enabled_provider_idx" ON "game_servers"("enabled", "provider");
CREATE INDEX "game_servers_guild_id_enabled_public_sort_order_idx" ON "game_servers"("guild_id", "enabled", "public", "sort_order");
CREATE INDEX "game_server_snapshots_hosting_state_gameplay_state_idx" ON "game_server_snapshots"("hosting_state", "gameplay_state");

ALTER TABLE "game_server_settings" ADD CONSTRAINT "game_server_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_server_snapshots" ADD CONSTRAINT "game_server_snapshots_game_server_id_fkey" FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
