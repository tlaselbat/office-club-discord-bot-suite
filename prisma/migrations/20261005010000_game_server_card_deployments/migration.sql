-- A card now represents a desired Discord deployment.  Keep existing message
-- identities while allowing the same registration to be shown in many channels.
CREATE TYPE "GameServerCardState" AS ENUM ('CREATING', 'HEALTHY', 'MISSING', 'ERROR');

ALTER TABLE "game_server_cards"
  ALTER COLUMN "message_id" DROP NOT NULL,
  ADD COLUMN "state" "GameServerCardState" NOT NULL DEFAULT 'CREATING',
  ADD COLUMN "last_reconciled_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;

UPDATE "game_server_cards"
SET "state" = 'HEALTHY', "last_reconciled_at" = "updated_at"
WHERE "message_id" IS NOT NULL;

DROP INDEX "game_server_cards_game_server_id_key";
CREATE UNIQUE INDEX "game_server_cards_game_server_id_channel_id_key"
  ON "game_server_cards"("game_server_id", "channel_id");
