-- Retained results are distinct from disposable match resources.
ALTER TYPE "MatchDiscordResourceType" ADD VALUE 'MATCH_RESULT_RECEIPT';
CREATE TYPE "DemoArtifactStatus" AS ENUM ('EXPECTED', 'SOURCE_READY', 'TRANSFERRING', 'STORED', 'UNAVAILABLE', 'EXPIRED', 'FAILED');

ALTER TABLE "guild_settings" ADD COLUMN "results_channel_id" TEXT;

ALTER TABLE "demo_references"
  ADD COLUMN "map_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "source_filename" TEXT,
  ADD COLUMN "storage_key" TEXT,
  ADD COLUMN "byte_count" BIGINT,
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "observed_at" TIMESTAMP(3),
  ADD COLUMN "collection_deadline_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "stored_at" TIMESTAMP(3),
  ADD COLUMN "expired_at" TIMESTAMP(3),
  ADD COLUMN "failure_reason" TEXT,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "demo_references" ALTER COLUMN "status" TYPE "DemoArtifactStatus" USING 'EXPECTED'::"DemoArtifactStatus";
ALTER TABLE "demo_references" ALTER COLUMN "status" SET DEFAULT 'EXPECTED';
ALTER TABLE "demo_references" DROP COLUMN "reference", DROP COLUMN "metadata";
DROP INDEX IF EXISTS "demo_references_match_id_map_name_idx";
CREATE UNIQUE INDEX "demo_references_match_id_map_number_key" ON "demo_references"("match_id", "map_number");
CREATE INDEX "demo_references_status_collection_deadline_at_idx" ON "demo_references"("status", "collection_deadline_at");
