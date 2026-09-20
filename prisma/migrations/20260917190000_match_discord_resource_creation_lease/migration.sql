-- A CREATE_IN_FLIGHT record is only reclaimable when no Discord creation call
-- was durably started. Once creation_io_started_at is set, the Discord side
-- effect is ambiguous after a crash and must never be guessed or deleted.
ALTER TABLE "match_discord_resources"
  ADD COLUMN "creation_attempt_id" TEXT,
  ADD COLUMN "creation_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "creation_io_started_at" TIMESTAMP(3);

CREATE INDEX "match_discord_resources_state_creation_lease_expires_at_idx"
  ON "match_discord_resources"("state", "creation_lease_expires_at");
