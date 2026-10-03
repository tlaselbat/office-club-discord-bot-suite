CREATE TABLE "game_server_cards" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "game_server_id" UUID NOT NULL,
  "channel_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "last_known_state" JSONB,
  "last_successful_poll_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_server_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_server_cards_game_server_id_key" ON "game_server_cards"("game_server_id");
CREATE INDEX "game_server_cards_guild_id_idx" ON "game_server_cards"("guild_id");

ALTER TABLE "game_server_cards" ADD CONSTRAINT "game_server_cards_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_server_cards" ADD CONSTRAINT "game_server_cards_game_server_id_fkey" FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
