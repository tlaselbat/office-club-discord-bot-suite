-- Discord channel cleanup is intentionally non-destructive. Archived channel
-- resources have been locked and renamed; only a Discord administrator may
-- perform final removal.
ALTER TYPE "MatchDiscordResourceState" ADD VALUE IF NOT EXISTS 'ARCHIVED';
