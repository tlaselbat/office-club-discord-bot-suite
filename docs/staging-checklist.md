# Staging Acceptance Checklist

For the ordered live procedure, use the [TenMan live beta test guide](tenman/live-beta-test-guide.md).

## Environment

- [ ] Node 22 runtime verified
- [ ] Empty PostgreSQL database is reachable through `DATABASE_URL`
- [ ] Migrations applied with `corepack pnpm prisma:migrate:deploy`
- [ ] Profiles seeded with `corepack pnpm prisma:seed`
- [ ] Public HTTPS URL is reachable by Steam and the game server
- [ ] `corepack pnpm discord:register` succeeds and commands appear in the test guild
- [ ] `/health/live` and `/health/ready` return 200

## Guild setup

- [ ] Bot has required Guilds, Members, Messages, and Voice States intents
- [ ] Bot has permissions to manage configured channels, messages, and voice
- [ ] `/match config configure`, `/match config setup`, and `/match admin diagnostics` succeed
- [ ] Setup creates only the managed category and expected children
- [ ] Teardown rejects an active or cleanup-held match and never removes manual channels
- [ ] Administrative confirmations reject another actor, expiration, and stale generation

## Queue and formation

- [ ] `TEST_DATABASE_URL` points to an isolated migrated database and `corepack pnpm test:tenman:simulation` completes the ten-player queue, ready, captain draft, veto, simulated DatHost/MatchZy lifecycle, result deduplication, and cleanup
- [ ] `/match admin queue-panel` creates or repairs one durable queue panel
- [ ] Ten Steam-assigned test users join; duplicate user and Steam identity are rejected or disputed
- [ ] Concurrent final joins create exactly one `READY_CHECK` match and timeout job
- [ ] Ready interactions reject stale components; deadline cancellation returns players safely
- [ ] Restart recreates the current forming-phase timeout job
- [ ] Captain selection, draft picks, and veto reject wrong-turn and stale interactions
- [ ] Veto selects one allowed map and only then starts provisioning
- [ ] Party queue join validates and inserts/removes its full cohort atomically
- [ ] Queue bans are enforced and audited

## Resources, results, and recovery

- [ ] Use a dedicated staging guild and disposable DatHost destination; never use the production guild, template, or a production match for this acceptance run
- [ ] Owned match text/dashboard resources are persisted and reconciled
- [ ] An accepted-but-unpersisted resource create remains operator-visible; no duplicate is guessed
- [ ] DatHost server is created only from the protected template
- [ ] Record the created destination ID, verify its `user_data` begins with `tenman:`, then verify it is stopped and deleted by the matching cleanup job; do not manually retry a duplicate request after an uncertain response
- [ ] MatchZy configuration is authenticated; duplicate `series_end` applies ratings once
- [ ] Rollback reverses active ledger effects without deleting history
- [ ] Cancellation and terminal completion enter cleanup; slot releases only after cleanup completes
- [ ] Restart recovers queue/dashboard, deadlines, provisioning, cleanup, and MatchZy reconciliation
- [ ] Orphan scanner reports no unexplained staging resources

## Verification

- [ ] `corepack pnpm format:check`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm lint`
- [ ] `corepack pnpm prisma:validate` with staging/test `DATABASE_URL`
- [ ] `corepack pnpm test`
- [ ] `TEST_DATABASE_URL` points to an isolated migrated database and `corepack pnpm test:database` passes
- [ ] `corepack pnpm build`
- [ ] No secrets appear in logs, Discord responses, or test artifacts

## Coverage boundary

`corepack pnpm test:tenman:simulation` is an automated PostgreSQL lifecycle simulation. It never calls Discord, DatHost, or MatchZy. Every unchecked item above remains a required, manually recorded staging acceptance step before beta release.
