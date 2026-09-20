CREATE TABLE "tenman_party_invites" (
  "id" UUID NOT NULL,
  "party_id" UUID NOT NULL,
  "invitee_discord_user_id" TEXT NOT NULL,
  "inviter_discord_user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenman_party_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenman_party_invites_party_id_invitee_discord_user_id_expires_at_idx"
  ON "tenman_party_invites"("party_id", "invitee_discord_user_id", "expires_at");
CREATE INDEX "tenman_party_invites_invitee_discord_user_id_expires_at_idx"
  ON "tenman_party_invites"("invitee_discord_user_id", "expires_at");

ALTER TABLE "tenman_party_invites"
  ADD CONSTRAINT "tenman_party_invites_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "tenman_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenman_party_invites"
  ADD CONSTRAINT "tenman_party_invites_invitee_discord_user_id_fkey"
  FOREIGN KEY ("invitee_discord_user_id") REFERENCES "users"("discord_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
