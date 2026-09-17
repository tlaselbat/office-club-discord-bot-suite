CREATE TABLE "reward_activity_receipts" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "source" "RewardSource" NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_activity_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reward_activity_receipts_guild_id_idempotency_key_key" ON "reward_activity_receipts"("guild_id", "idempotency_key");
CREATE INDEX "reward_activity_receipts_guild_id_created_at_idx" ON "reward_activity_receipts"("guild_id", "created_at");
ALTER TABLE "reward_activity_receipts" ADD CONSTRAINT "reward_activity_receipts_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "suite_guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;
