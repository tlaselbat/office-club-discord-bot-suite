-- Drop the OpenID link session table and its indexes.
DROP TABLE IF EXISTS "steam_link_sessions";

-- Reframe Steam identity from "verified" to "assigned".
ALTER TABLE "steam_identities"
  RENAME COLUMN "verified_at" TO "assigned_at";

ALTER TABLE "steam_identities"
  ALTER COLUMN "assigned_at" SET DEFAULT now();

ALTER TABLE "steam_identities"
  ADD COLUMN IF NOT EXISTS "assignment_source" TEXT NOT NULL DEFAULT 'MODAL_SELF_ASSIGN';

ALTER TABLE "steam_identities"
  ALTER COLUMN "provenance" SET DEFAULT 'SELF_ASSIGNMENT';

-- Partial unique indexes: only one active Steam ID per Discord user and vice versa.
CREATE UNIQUE INDEX IF NOT EXISTS "steam_identities_active_discord_user_id_key"
  ON "steam_identities" ("discord_user_id")
  WHERE "invalidated_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "steam_identities_active_steam_id_64_key"
  ON "steam_identities" ("steam_id_64")
  WHERE "invalidated_at" IS NULL;

-- Dispute table for duplicate Steam assignment review.
CREATE TABLE IF NOT EXISTS "steam_assignment_disputes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "steam_id_64" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "actor_discord_user_id" TEXT,
  "resolution" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "steam_assignment_disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "steam_assignment_disputes_guild_id_status_idx"
  ON "steam_assignment_disputes" ("guild_id", "status");

CREATE INDEX IF NOT EXISTS "steam_assignment_disputes_user_steam_idx"
  ON "steam_assignment_disputes" ("discord_user_id", "steam_id_64");

ALTER TABLE "steam_assignment_disputes"
  ADD CONSTRAINT "steam_assignment_disputes_discord_user_id_fkey"
  FOREIGN KEY ("discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve party grouping through match formation and requeue.
ALTER TABLE "match_players"
  ADD COLUMN IF NOT EXISTS "party_id" UUID;

CREATE INDEX IF NOT EXISTS "match_players_party_id_idx"
  ON "match_players" ("party_id");

ALTER TABLE "match_players"
  ADD CONSTRAINT "match_players_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
