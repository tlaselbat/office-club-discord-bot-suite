# Configuration Reference

## Runtime requirements

- Node.js 22 or newer
- pnpm 10.15.1 through Corepack
- PostgreSQL
- A public HTTPS origin reachable by Steam and the DatHost-hosted MatchZy server

## Environment variables

| Variable                             | Required | Default       | Validation and use                                                                    |
| ------------------------------------ | -------- | ------------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV`                           | no       | `development` | `development`, `test`, or `production`                                                |
| `HOST`                               | no       | `0.0.0.0`     | Non-empty HTTP bind host                                                              |
| `PORT`                               | no       | `3000`        | Integer from 1 through 65535                                                          |
| `LOG_LEVEL`                          | no       | `info`        | `fatal`, `error`, `warn`, `info`, `debug`, or `trace`                                 |
| `POSTGRES_PASSWORD`                  | Docker   | —             | PostgreSQL container password used by `compose.yaml`                                  |
| `DATABASE_URL`                       | yes      | —             | Must start with `postgresql://`                                                       |
| `DISCORD_TOKEN`                      | yes      | —             | Bot token; also used by `pnpm discord:register`                                       |
| `DISCORD_CLIENT_ID`                  | yes      | —             | Application ID containing 17-20 digits                                                |
| `DISCORD_CLIENT_SECRET`              | yes      | —             | OAuth client secret for the owner panel                                               |
| `PANEL_OWNER_DISCORD_USER_IDS`       | yes      | —             | Comma-separated Discord user IDs allowed to access `/admin`                           |
| `PANEL_SESSION_SECRET`               | yes      | —             | At least 32 characters; signs OAuth state and CSRF tokens                             |
| `DATHOST_EMAIL`                      | yes      | —             | DatHost API account email                                                             |
| `DATHOST_PASSWORD`                   | yes      | —             | DatHost API account password                                                          |
| `DATHOST_TEMPLATE_SERVER_ID`         | yes      | —             | Globally protected template ID used by ownership safety checks                        |
| `PUBLIC_BASE_URL`                    | yes      | —             | HTTPS origin for the admin panel and MatchZy config/events endpoints                  |
| `MATCH_TOKEN_SIGNING_SECRET`         | yes      | —             | At least 32 characters; signs Discord component IDs                                   |
| `CREDENTIAL_ENCRYPTION_KEY`          | yes      | —             | Base64 value decoding to exactly 32 bytes                                             |
| `STEAM_API_KEY`                      | no       | —             | Optional Steam Web API key; enables vanity-URL resolution and display-name enrichment |
| `R2_ACCOUNT_ID`                      | no       | —             | Optional Cloudflare R2 (S3-compatible) account ID for demo/artifact storage           |
| `R2_BUCKET`                          | no       | —             | Bucket for match demo artifacts; required when the other `R2_*` values are set        |
| `R2_ACCESS_KEY_ID`                   | no       | —             | S3 access key for the artifact bucket                                                 |
| `R2_SECRET_ACCESS_KEY`               | no       | —             | S3 secret key for the artifact bucket                                                 |
| `DEMO_RETENTION_DAYS`                | no       | `90`          | Integer from 1 through 3650; expiry applied to stored demo artifacts                  |
| `DEMO_COLLECTION_DEADLINE_SECONDS`   | no       | `1800`        | Integer from 60 through 7200; artifact collection cutoff after series end             |
| `WORKER_POLL_INTERVAL_MS`            | no       | `1000`        | Integer from 100 through 60000 milliseconds                                           |
| `MATCHZY_RECONCILIATION_INTERVAL_MS` | no       | `30000`       | Integer from 5000 through 300000 milliseconds; recurring reconciliation schedule      |
| `MATCHZY_STALE_AFTER_MS`             | no       | `120000`      | Integer of at least 30000 milliseconds                                                |

The application validates the complete runtime environment before startup. The dedicated command-registration script validates only its two Discord variables.

Configure `https://<PUBLIC_BASE_URL host>/admin/auth/callback` as a redirect in the Discord Developer Portal. The panel requests only the `identify` OAuth scope, stores no Discord OAuth tokens, and issues opaque eight-hour server-side sessions. Only IDs in `PANEL_OWNER_DISCORD_USER_IDS` can establish a session. Runtime secrets and managed channel lifecycle operations are never exposed in the panel.

## Generating secrets

Generate the component signing secret and encryption key independently:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

The second output must decode to exactly 32 bytes. Keep all values outside source control and rotate them through a planned operational procedure; changing the signing secret invalidates existing panel controls, and changing the encryption key prevents existing encrypted match passwords from being decrypted.

## Guild settings

`/match config configure` stores:

- Lobby text channel used for the persistent panel
- Lobby, Team 1, and Team 2 voice channels
- Privileged, moderator, and administrator role IDs
- DatHost template server ID
- Default DatHost location (`dallas` when omitted)
- Default enabled game-profile key (`competitive_5v5` when omitted)
- Enabled flag

Settings are versioned and configuration changes are audited. Initial configuration requires native Discord Administrator permission. Later configuration accepts either native Administrator or the configured administrator role.

A match cannot be created until settings are enabled and have a default profile. Creation also requires the configured lobby text channel to remain available.

## Member Rewards settings

Configure Member Rewards from `/admin/guilds/<guild-id>/rewards`, then enable it independently from Office Club Competitive. Settings include text XP and cooldown, allowlisted text channels, voice XP and interval, allowlisted voice channels, guild-tag duration and role, reconciliation interval, and ordered level thresholds with optional roles.

The structured level table accepts a level number, XP threshold, optional label, and optional Discord role. Thresholds must be nonnegative and strictly increasing. Configured roles must be unmanaged and below the bot's highest role. Manual XP adjustments require a member ID, nonzero signed amount, and reason; they create immutable ledger and audit records.

Disabling Member Rewards preserves XP, streak history, settings, and managed roles. It stops new awards and closes active voice sessions so disabled time cannot be credited after re-enabling. Message content is neither requested nor stored.

## Game profiles

Profiles are database records and must be seeded before guild configuration. Only profiles with `enabled = true` are offered or accepted.

Profile capacity is `players_per_team × 2`. The configured default profile is
used when queue promotion creates a match; formation policy rejects unsupported
sizes before an invalid draft can begin. Profile and map allowlists remain
limited to Discord's 25-option control limit.

Discord selectors show at most 25 maps and profiles because of Discord API limits. Keep configured allowlists and enabled-profile counts within that accessible range until pagination is added.

## Managed Discord resources

Automated setup stores `managedResourceState`, a per-resource setup step, a UUID attempt ID, the managed category ID, managed child IDs, and `managedResourcesCreatedAt`. Existing/manual configurations remain `NONE` with no inferred ownership. `SETTING_UP` records durable progress and possible ambiguous Discord create outcomes; `ACTIVE` owns a complete managed layout; `TEARING_DOWN` retains only unresolved deletions.

No Discord API call occurs inside a PostgreSQL transaction. Each phase persists intent under a guild advisory transaction lock, commits, performs one Discord operation, then persists its outcome with optimistic settings-version and attempt checks. Active ownership timestamps are cleared at `NONE`; audit events retain history.

`MATCH_TOKEN_SIGNING_SECRET` also signs domain-separated administrative confirmations and must therefore be persistent and identical across all running instances.

## Database-owned invariants

The initial schema migration creates the PostgreSQL partial unique index `matches_one_active_slot_per_guild`. Prisma does not model this partial index directly; do not remove it when generating later migrations.

The migration intentionally fails when existing data has multiple `guild_slot_active = true` rows for one guild. Follow the preflight and remediation steps in [Operations](operations.md).
