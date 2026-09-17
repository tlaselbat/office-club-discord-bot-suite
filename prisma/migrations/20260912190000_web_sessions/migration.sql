CREATE TABLE "web_sessions" (
  "id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_sessions_token_hash_key" ON "web_sessions"("token_hash");
CREATE INDEX "web_sessions_expires_at_idx" ON "web_sessions"("expires_at");
