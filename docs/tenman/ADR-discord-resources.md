# ADR: Explicit match Discord-resource ownership and module interaction boundary

## Decision

Each match owns a `MatchDiscordResource` record for every disposable
resource, initially `MATCH_TEXT_CHANNEL` and `MATCH_DASHBOARD_MESSAGE`.
Creation intent is committed before Discord I/O; a returned Discord ID is
persisted in a short recovery-safe transaction. The bot deletes a resource
only when an active ownership row ties that exact ID to the match and says the
bot created it. Guild `managedChannelIds` remains reserved for shared setup
resources.

The persistent queue panel is identified on `TenManQueue`. The match
dashboard is identified by a `MATCH_DASHBOARD_MESSAGE` resource. Both render
from database state and can be reconciled after deletion/restart.

Tenman owns `/10man`, `/match`, `/steam` and `tmq:`, `tmm:`, `tma:` handling
through `src/modules/tenman/bot/interaction-router.ts`. The suite client only
calls `ModuleRegistry.dispatch`; Rewards remains an independent module.

## Component contract

- `tmq:` binds guild ID, queue version, action, and optional target actor.
- `tmm:` binds action, match ID, match version, phase generation, and optional
  target actor.
- `tma:` binds actor, guild, match where applicable, action, expected version,
  generation, and expiry.
- Every callback rereads durable state and authorizes at execution time.
