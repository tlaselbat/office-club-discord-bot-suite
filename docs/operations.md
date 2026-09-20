# Operations Runbook

## Prerequisites

- Node.js 22 or the provided Node 22 container image
- PostgreSQL reachable through `DATABASE_URL`
- Complete runtime environment from [Configuration](configuration.md)
- Discord and DatHost credentials with the permissions documented in [Permissions](permissions.md)

## Automated Ubuntu deployment

Requirements:

- Ubuntu server with sudo/root access
- Repository cloned onto the server
- DNS-ready domain pointing to the server
- Inbound TCP ports 80 and 443 reachable
- Discord and DatHost credentials available

Run:

```bash
sudo bash scripts/setup-ubuntu.sh
```

The script installs base packages, Docker Engine with the Compose plugin, and Caddy from their official repositories when absent. It securely prompts for credentials, generates PostgreSQL/signing/encryption secrets, writes `.env` with mode 600, binds the application only to `127.0.0.1:3000`, configures Caddy automatic HTTPS, applies migrations, seeds profiles, registers slash commands, starts the stack, and checks local/public readiness.

On rerun, the installer automatically preserves the existing `.env`, retaining the database password and persistent encryption and HMAC keys. Do not regenerate those keys for an existing database: old encrypted credentials and signed administrative controls depend on them. Existing Caddy configuration is preserved and receives an import of `/etc/caddy/Caddyfile.d/*` plus the managed `10manbot.caddy` site file.

If UFW is already active, the script allows OpenSSH and TCP 80/443; it does not enable an inactive firewall. Review `docker compose logs app` and `journalctl -u caddy` if verification fails.

## Manual deployment order

Before applying the active-slot migration, run:

```sql
SELECT guild_id, COUNT(*)
FROM matches
WHERE guild_slot_active = true
GROUP BY guild_id
HAVING COUNT(*) > 1;
```

If rows are returned, stop. Inspect every affected match, provisioning attempt, cleanup status, and DatHost ownership marker. Do not arbitrarily deactivate a row while an external disposable server may still exist. The migration repeats this check and intentionally aborts instead of choosing a winner.

Before the suite/rewards migration, take a PostgreSQL backup and record these counts:

```sql
SELECT COUNT(*) FROM guild_settings;
SELECT COUNT(*) FROM matches WHERE guild_slot_active = true;
SELECT managed_resource_state, COUNT(*) FROM guild_settings GROUP BY managed_resource_state;
```

After migration, every `guild_settings.guild_id` must have one matching `suite_guilds.guild_id`; the match and managed-resource counts must be unchanged. Verify the reward ledger idempotency index, activity-receipt idempotency index, and partial active-voice-session index exist. Restore the backup rather than manually editing migration history if validation fails.

For database-backed reward concurrency checks, create an isolated migrated test database and run `TEST_DATABASE_URL=postgresql://... corepack pnpm test:database`. The test creates uniquely named rows and removes them afterward. Never point `TEST_DATABASE_URL` at production.

Deploy with:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm prisma migrate deploy
corepack pnpm prisma db seed
corepack pnpm build
corepack pnpm discord:register
corepack pnpm start
```

Run `discord:register` after the first deployment and whenever slash command definitions change. Normal startup does not register commands.

## Startup and shutdown

Startup connects Prisma, starts the HTTP listener, logs in to Discord, runs recovery, and starts the worker. Recovery:

- Re-enqueues unfinished provisioning, boot, cleanup, voice, and panel work.
- Reactivates recurring `ORPHAN_SCAN` and `MATCHZY_RECONCILE` singleton jobs.
- Resumes `SERVER_READY` matches at MatchZy loading rather than inventing another boot transition.

The worker uses durable PostgreSQL leases and prevents overlapping polling cycles within the process. Shutdown stops scheduling new work, waits for the in-flight worker operation, destroys Discord, closes HTTP, and disconnects Prisma.

## Health checks

- Liveness: `GET /health/live` returns `200 {"status":"ok"}` when the process can serve requests.
- Readiness: `GET /health/ready` performs a database query and returns 200 for ready or 503 for unavailable.

Health responses intentionally omit dependency details.

## Logs and user error references

Logs are structured Pino records. Sensitive token/password/header fields are redacted by `src/logging/logger.ts`.

Expected user mistakes should produce safe actionable Discord messages. Unexpected interaction failures include an interaction correlation reference in the user response. Search logs by `interactionId`, then correlate with `guildId`, `userId`, command name, match audit events, and job `last_error`. Never paste raw credentials or private connect commands into tickets.

## Monitoring durable work

Monitor job counts by `type`, `status`, `attempts`, `run_at`, and lease expiry. In particular:

- `ORPHAN_SCAN` and `MATCHZY_RECONCILE` should return to `PENDING` with a future `run_at` after successful execution.
- A recurring singleton left `COMPLETE` is abnormal after startup recovery.
- Expired `RUNNING` leases are eligible for recovery.
- Repeated `RETRY` jobs should be investigated before attempt exhaustion.

`MATCHZY_RECONCILE` uses `MATCHZY_RECONCILIATION_INTERVAL_MS`; stale-event classification uses `MATCHZY_STALE_AFTER_MS`. Orphan scanning currently recurs hourly.

## Provisioning failure

`PROVISION_SERVER` and `POLL_SERVER_BOOT` use bounded retries. When attempts are exhausted, durable failure recovery:

1. Moves the nonterminal match to `FAILED`.
2. Stores a truncated safe failure reason and truthful state transition.
3. Sets cleanup to `PENDING` if a server or provisioning attempt may exist.
4. Keeps the guild slot active while cleanup is required.
5. Upserts cleanup and panel-refresh work.
6. Releases the slot immediately only when no external resource can exist.

If permanent-failure recovery itself fails, the source job returns to retry rather than being discarded.

### Unknown or ambiguous duplicate outcome

Do not manually issue another duplicate request. Inspect the latest `ProvisioningAttempt`, then list DatHost servers matching its `user_data`, provisional name, location, and request window. Template IDs must never be adopted as disposable destinations.

An `AMBIGUOUS` attempt requires operator resolution. Update ownership fields only after positively identifying the disposable server, then re-enqueue the appropriate provisioning, boot, or cleanup job.

## Cleanup failure and blocked guild slot

Cleanup revokes credentials and restores voice before deleting the owned disposable server. A missing server is success. Template and ownership checks can intentionally prevent deletion.

If cleanup exhausts retries:

1. Correct DatHost credentials, network access, Discord voice permissions, or ownership data.
2. Reset/upsert `CLEANUP_MATCH` with idempotency key `cleanup:<matchId>` to `PENDING` and a current `run_at`.
3. Confirm cleanup reaches `COMPLETE` and `guild_slot_active` becomes false.

Do not manually release the slot while a bot-owned disposable server may remain.

## Managed setup and teardown recovery

`SETTING_UP/RESERVED` with no IDs can be cleared through `/match admin recover-setup`. A `*_CREATE_IN_FLIGHT` step means Discord may have accepted a create before its ID was persisted. Inspect Discord and its audit log, manually remove any untracked resource from that attempt, then use the signed recovery acknowledgement. Never adopt or delete by name.

Partial tracked setup rollback and `TEARING_DOWN` retain unresolved persisted IDs. Restore Manage Channels/network access and rerun recovery or teardown. Every Discord operation occurs outside PostgreSQL transactions; state/attempt/version checks serialize phases. All instances must share the same persistent `MATCH_TOKEN_SIGNING_SECRET` for confirmations to survive restarts.

Disable is safe during an active match because it blocks only new creation. Enable validates existing channels, roles, permissions, profile, and managed consistency. Teardown always refuses while a guild slot is active.

## Missing persistent panel

Queue and match-dashboard reconciliation recreate a recorded message only in a
durably owned resource. If the resource is missing, inspect diagnostics and the
ownership row before retrying `MATCH_DASHBOARD_REFRESH`; do not adopt a message
or channel by name.

## Orphaned servers

`ORPHAN_SCAN` reports unaccounted resources but does not blindly delete them. Resolve ownership from persisted markers and provisioning attempts. Delete only a positively identified bot-owned disposable server, never a configured template.

## Steam relinking

Users can run `/steam replace`. The replacement verification invalidates the prior active identity only after successful Steam OpenID completion. Relinking is rejected while that Discord identity is protected by a locked, provisioning, loaded, warmup, live, or paused match.
