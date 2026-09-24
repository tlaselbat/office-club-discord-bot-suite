# Staging Acceptance Checklist

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

- [ ] Owned match text/dashboard resources are persisted and reconciled
- [ ] An accepted-but-unpersisted resource create remains operator-visible; no duplicate is guessed
- [ ] DatHost server is created only from the protected template
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
