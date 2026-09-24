# Architecture

## Overview

```text
Discord manages users and the human workflow.
The backend owns authorization, state transitions, and orchestration.
PostgreSQL provides durable state, jobs, audit history, and concurrency guarantees.
DatHost manages disposable server infrastructure.
MatchZy manages the CS2 match and reports authenticated events.
```

## Runtime components

| Component            | Responsibility                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Discord bot          | Slash commands, signed components, persistent panels, private connection details, voice movement |
| Fastify HTTP service | Health checks, owner-only web administration, and authenticated MatchZy endpoints                |
| Worker runner        | Exclusively leases durable jobs and executes one polling cycle at a time                         |
| PostgreSQL           | Match state, one-active-slot invariant, jobs, credentials, events, audit history                 |
| DatHost client       | Disposable server creation, duplication, configuration, lifecycle, and console commands          |
| MatchZy integration  | Config builder, event ingestion, score updates, reconciliation, semantic command allowlist       |

Slash command definitions are deployed explicitly with `pnpm discord:register`; application startup does not modify global Discord commands.

## Module architecture

The application is a modular monolith: one Discord client, Fastify server, PostgreSQL database, and durable worker host compile-time modules through `src/core/modules`. The registry rejects duplicate module, command, component-prefix, and job namespaces and composes startup/shutdown hooks. Disabled modules remain registered but reject or ignore new mutations while preserving durable state.

`GuildSettings` maps to the shared `suite_guilds` parent. `TenManSettings` retains the existing `guild_settings` table and all match/channel/provisioning configuration, while `RewardSettings` owns rewards policy. This separation lets each module evolve and toggle independently without weakening existing match foreign keys.

Member Rewards uses an immutable signed-amount ledger plus transactionally maintained effective XP and level projections. Text awards use database-idempotent cooldown buckets. Voice sessions persist checkpoints and reconcile after restart. Guild-tag observations treat Discord fetch errors as unknown, so outages never reset a streak or remove a loyalty role.

## Guild and match invariants

- PostgreSQL enforces at most one row with `guild_slot_active = true` per guild through the migration-owned partial unique index `matches_one_active_slot_per_guild`.
- Match creation also takes a guild-scoped advisory transaction lock so concurrent callers receive a deterministic conflict.
- The persistent panel is published only in the configured lobby text channel. If initial publication fails, the new match is compensated to `FAILED` and its slot is released because no external server exists.
- A terminal match can continue to hold the guild slot while external cleanup is pending. Cleanup completion releases it.
- Enabled game profiles determine lobby capacity. Profile changes reject over-capacity rosters and reset team assignments; they also clear a map that the new profile does not allow.

## State machines

### Match state

Normal progression:

`CREATED → READY_CHECK → TEAM_SELECTION → MAP_VETO → TEAMS_LOCKED → SERVER_PROVISIONING → SERVER_BOOTING → SERVER_READY → MATCH_LOADED → WARMUP → LIVE ↔ PAUSED → FINISHED`

Queue promotion creates the roster atomically. Ready, captain selection, draft,
and veto are deadline-driven durable phases rather than mutable lobby states.

Terminal states are `FINISHED`, `CANCELED`, and `FAILED`. Exhausted provisioning or boot retries move the match to `FAILED`, preserve a safe failure reason, and queue cleanup when a DatHost resource may exist.

### Cleanup state

`NOT_REQUIRED → PENDING → RUNNING → RETRY → COMPLETE`

Cleanup is independent of the match outcome. It revokes match credentials, returns participants to lobby voice, and safely deletes only the owned disposable server. A missing disposable server is treated as successful cleanup.

### Provisioning attempt state

`DUPLICATE_REQUEST_PENDING → DUPLICATE_OUTCOME_UNKNOWN → SERVER_IDENTIFIED → COMPLETE`

An ambiguous duplicate outcome requires operator review. Unknown or ambiguous outcomes are treated conservatively: the guild slot is not released until ownership and cleanup are resolved.

## Durable jobs

| Job                       | Behavior                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `PROVISION_SERVER`        | Creates or reconciles a destination, duplicates/configures the template, and starts the server |
| `POLL_SERVER_BOOT`        | Polls DatHost, persists `SERVER_READY`, loads MatchZy, then persists `MATCH_LOADED`            |
| `VOICE_RECONCILE`         | Moves Discord participants to the voice channel matching their team                            |
| `MATCH_DASHBOARD_REFRESH` | Re-renders the owned match dashboard, including current score and controls                     |
| `CLEANUP_MATCH`           | Revokes credentials, restores lobby voice, and deletes the owned server                        |
| `ORPHAN_SCAN`             | Periodically reports DatHost resources that are not accounted for                              |
| `MATCHZY_RECONCILE`       | Periodically recovers missed terminal events and records stale-event observations              |

Handlers return either completion or a future reschedule time. Recurring jobs are reset to `PENDING` with their next `run_at`; they are not marked complete after rescheduling. Startup recovery reactivates recurring singleton jobs and resumes unfinished matches. The runner prevents overlapping `runOnce` calls and waits for in-flight work during shutdown.

## Managed guild resources

Managed setup persists a guild attempt and an explicit create-in-flight step before each Discord API request. The transaction commits before Discord is awaited; the returned ID is persisted in a new short version-checked transaction. Accepted-but-unpersisted creates remain explicitly ambiguous and are never adopted or deleted by name. `/match config recover-setup` requires operator inspection/manual cleanup and signed acknowledgement.

Managed teardown is actor/guild/version/generation-bound, expires after five minutes, refuses active guild slots, clears functional IDs only after archiving and locking tracked resources, and never deletes Discord channels. Partial work remains disabled and retryable. Manual channels have no managed ownership and cannot be changed through teardown. `managedResourcesCreatedAt` exists only while active ownership exists; audits retain lifecycle history.

Soft disable prevents only new match creation. Existing match components, MatchZy events, workers, completion, and cleanup continue.

## Discord interaction model

- Commands are deferred ephemerally before database or external I/O.
- Panel mutations defer the source-message update immediately.
- Private operations such as connect information and the second team-assignment step use ephemeral replies.
- Team assignment uses one participant selector followed by signed ephemeral Team 1 / Team 2 buttons, keeping every panel at or below Discord's five-row limit.
- Component IDs are HMAC-signed and bind action, match ID, match version, and, when applicable, the target Discord user ID.
- Expected failures return safe actionable messages. Unexpected failures return a correlation reference while structured logs retain internal details.

## Security model

- The `/admin` panel uses Discord `identify` OAuth, an explicit owner-ID allowlist, hashed eight-hour server-side sessions, session-bound CSRF tokens, no-store responses, and a restrictive content security policy.
- Panel settings writes reuse guild validation and auditing; managed setup, recovery, teardown, and runtime secrets remain outside the web surface.
- No raw Discord-to-RCON path exists.
- MatchZy commands are allowlisted and rendered in `src/modules/tenman/integrations/matchzy/commands.ts`.
- MatchZy tokens are scoped (`CONFIG_READ` or `EVENT_WRITE`) and bound to a match and server generation.
- RCON and join passwords are encrypted with AES-256-GCM; tokens are stored as hashes.
- Steam accounts are self-reported assignments, not verified ownership; assignment changes are advisory-locked and blocked while the identity is queued or protected by a live match.
- DatHost template IDs are protected from reconfiguration and deletion by ownership checks.
- Connection commands, Steam account details, diagnostics, and interaction errors are ephemeral.
- Pino redaction covers configured token, password, and authorization fields.
