-- This project has no deployed V1 bot. Refuse an accidental conversion of
-- legacy match data instead of inventing a migration for it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "matches"
    WHERE "workflow_version" <> 'V2'
       OR "state"::text IN ('OPEN', 'FULL', 'TEAM_SETUP')
  ) THEN
    RAISE EXCEPTION 'V2-only migration refused: legacy 10man match rows exist';
  END IF;
END $$;

ALTER TABLE "matches" ALTER COLUMN "state" DROP DEFAULT;
CREATE TYPE "MatchState_v2" AS ENUM (
  'CREATED', 'READY_CHECK', 'TEAM_SELECTION', 'MAP_VETO', 'TEAMS_LOCKED',
  'SERVER_PROVISIONING', 'SERVER_BOOTING', 'SERVER_READY', 'MATCH_LOADED',
  'WARMUP', 'LIVE', 'PAUSED', 'FINISHED', 'CANCELED', 'FAILED'
);
ALTER TABLE "matches"
  ALTER COLUMN "state" TYPE "MatchState_v2" USING "state"::text::"MatchState_v2";
ALTER TABLE "match_state_transitions"
  ALTER COLUMN "from_state" TYPE "MatchState_v2" USING "from_state"::text::"MatchState_v2",
  ALTER COLUMN "to_state" TYPE "MatchState_v2" USING "to_state"::text::"MatchState_v2";
DROP TYPE "MatchState";
ALTER TYPE "MatchState_v2" RENAME TO "MatchState";
ALTER TABLE "matches" ALTER COLUMN "state" SET DEFAULT 'CREATED';

ALTER TABLE "matches"
  DROP COLUMN "workflow_version",
  DROP COLUMN "discord_panel_channel_id",
  DROP COLUMN "discord_panel_message_id";
ALTER TABLE "guild_settings"
  DROP COLUMN "v2_enabled",
  DROP COLUMN "registration_required";
DROP TYPE "TenManWorkflowVersion";
