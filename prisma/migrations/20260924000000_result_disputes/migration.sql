-- Match result disputes submitted by players and reviewed by staff.
CREATE TABLE IF NOT EXISTS "match_result_disputes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "match_id" UUID NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "actor_discord_user_id" TEXT,
  "resolution" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "match_result_disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "match_result_disputes_match_id_idx"
  ON "match_result_disputes" ("match_id");

CREATE INDEX IF NOT EXISTS "match_result_disputes_status_idx"
  ON "match_result_disputes" ("status");

ALTER TABLE "match_result_disputes"
  ADD CONSTRAINT "match_result_disputes_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
