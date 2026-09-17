# Staging Acceptance Checklist

## Environment and deployment

- [ ] Node 22 runtime verified
- [ ] PostgreSQL reachable through `DATABASE_URL`
- [ ] Active-slot preflight query returns no duplicate guild rows
- [ ] Migrations applied with `pnpm prisma migrate deploy`
- [ ] Partial unique index `matches_one_active_slot_per_guild` exists
- [ ] Profiles seeded with `pnpm prisma db seed`
- [ ] Public HTTPS URL is reachable externally
- [ ] `pnpm discord:register` succeeds
- [ ] Global slash commands become visible in the staging guild
- [ ] `GET /health/live` returns 200
- [ ] `GET /health/ready` returns 200 with PostgreSQL available

## Discord configuration

- [ ] Bot invited with `bot` and `applications.commands` scopes
- [ ] Lobby text, lobby voice, Team 1 voice, and Team 2 voice channels exist
- [ ] Privileged, moderator, and administrator roles exist
- [ ] Native Discord administrator completes first `/match admin configure` with no existing settings row
- [ ] Configured administrator role can reconfigure afterward
- [ ] Disabled profile is rejected as the default
- [ ] `/match admin diagnostics` passes

## Managed resources

- [ ] `/match admin setup` creates the exact category and four children without overwrites
- [ ] Setup intent/outcome transactions do not remain open during Discord calls
- [ ] Soft disable blocks new creation while an existing match remains operable
- [ ] Enable validates intact resources and creates/deletes nothing
- [ ] Teardown refuses active and cleanup-held guild slots
- [ ] Teardown confirmation is actor-bound and expires after five minutes
- [ ] Manual channels are never teardown-eligible
- [ ] Empty setup reservation has a recovery path
- [ ] Accepted-but-unpersisted create is reported ambiguous and never adopted/deleted by name
- [ ] Partial teardown retains only unresolved IDs and succeeds on rerun
- [ ] Completed teardown clears active ownership timestamp but preserves audit history
- [ ] All bot instances share the persistent administrative signing key

## Steam

- [ ] Ten test Discord accounts complete `/steam register`
- [ ] Callback page confirms successful linking
- [ ] `/steam status` shows each SteamID64
- [ ] `/steam replace` replaces an unlocked identity
- [ ] Replacement is rejected while the identity is protected by a locked/live match
- [ ] Expired or reused OpenID sessions fail safely

## Lobby and panel UX

- [ ] Running `/10man create` outside the lobby publishes the panel in the configured lobby text channel
- [ ] Missing/inaccessible configured lobby channel rejects creation before an active match remains
- [ ] Simulated panel-send failure compensates the match and releases its slot
- [ ] Concurrent create requests produce exactly one active match
- [ ] Every match state renders no more than five action rows
- [ ] Tenth join changes the match to `FULL` and successfully refreshes the panel
- [ ] Team assignment uses participant selector followed by ephemeral Team 1 / Team 2 buttons
- [ ] Tampered, stale, cross-match, unauthorized, and departed-target team choices fail safely
- [ ] Commands and components acknowledge immediately without “interaction failed” banners
- [ ] Unexpected failures return a reference that resolves to structured logs

## Profiles, maps, and roster

- [ ] Only enabled profiles appear in controls
- [ ] Over-capacity profile change is rejected without mutation
- [ ] Exact-capacity profile change sets `FULL`
- [ ] Under-capacity profile change sets `OPEN`
- [ ] Profile change resets team assignments
- [ ] Disallowed selected map is cleared after profile change
- [ ] Concurrent join/profile changes preserve capacity and state invariants
- [ ] Map and profile lists remain usable within Discord's 25-option limit

## Provisioning and live match

- [ ] Teams and map lock transactionally
- [ ] DatHost destination is created from the protected template
- [ ] State records `SERVER_PROVISIONING → SERVER_BOOTING → SERVER_READY → MATCH_LOADED`
- [ ] Restart during booting resumes polling
- [ ] Restart during ready resumes MatchZy loading
- [ ] MatchZy config loads through the authenticated internal endpoint
- [ ] CS2 membership matches backend teams
- [ ] Discord voice reconciles to Team 1 / Team 2
- [ ] Force start, pause, resume, restore, and end controls work
- [ ] Round/map score appears in ephemeral and persistent panels
- [ ] `series_end` persists result and queues cleanup

## Member Rewards

- [ ] Server Members Intent is enabled and the bot has Manage Roles
- [ ] Rewards settings save through `/admin` with valid channel and role allowlists
- [ ] Stale settings versions and invalid CSRF tokens are rejected
- [ ] Two messages inside the elapsed cooldown produce one award
- [ ] Messages outside allowlisted channels and bot/webhook messages produce no award
- [ ] Voice join, move, leave, restart, disable, and re-enable produce exact whole-interval awards
- [ ] Removing an active voice channel from the allowlist closes its reward session
- [ ] Level threshold changes enqueue role reconciliation and never modify unrelated roles
- [ ] Positive and negative manual adjustments preserve immutable ledger and audit history
- [ ] Leaderboard paging and profile progress match database totals
- [ ] Guild-tag wear grants the role only after continuous qualification
- [ ] Removing and re-wearing the tag removes the role and restarts progress
- [ ] Simulated Discord fetch failure preserves the current guild-tag streak and role
- [ ] Rewards diagnostics report missing channels, blocked roles, stale sessions, and failed jobs

## Durable work and recovery

- [ ] Worker does not overlap polling cycles during a slow handler
- [ ] Shutdown waits for in-flight worker work
- [ ] `ORPHAN_SCAN` runs and returns to future `PENDING`
- [ ] `MATCHZY_RECONCILE` runs at the configured interval and returns to future `PENDING`
- [ ] Restart reactivates recurring singleton jobs
- [ ] Missed `series_end` is recovered when the DatHost server disappears
- [ ] Stale events with a running server are recorded without forcing completion
- [ ] Unknown duplicate outcome does not create a second server
- [ ] Ambiguous ownership remains blocked for operator review
- [ ] Exhausted provisioning before server creation marks `FAILED` and releases the slot safely
- [ ] Exhausted provisioning/boot with possible server marks `FAILED`, queues cleanup, and keeps the slot blocked
- [ ] Failure panel is refreshed with safe status information

## Cleanup and safety

- [ ] Credentials are revoked
- [ ] Participants return to lobby voice
- [ ] Disposable server is deleted
- [ ] Missing disposable server is accepted as cleanup success
- [ ] Guild slot releases only after required cleanup completes
- [ ] A second match can be created after release
- [ ] Protected template remains untouched
- [ ] Orphan scanner reports no unexplained staging resources

## Verification and sign-off

- [ ] `pnpm format:check`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm prisma:validate` with staging/test `DATABASE_URL`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] No secrets in logs, Discord responses, or test artifacts
- [ ] Architecture, configuration, permissions, operations, and troubleshooting docs reviewed
