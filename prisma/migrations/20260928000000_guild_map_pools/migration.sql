-- Per-guild map pools keep configuration mutable without changing profile defaults
-- or match snapshots that have already been promoted.
ALTER TABLE "guild_settings"
  ADD COLUMN IF NOT EXISTS "active_map_pool" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "guild_workshop_maps" (
  "guild_id" TEXT NOT NULL,
  "map_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "added_by_discord_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guild_workshop_maps_pkey" PRIMARY KEY ("guild_id", "map_name"),
  CONSTRAINT "guild_workshop_maps_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guild_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);
