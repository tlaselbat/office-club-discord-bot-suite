# Office Club Discord Bot Suite

A modular Discord server-management suite with independently configurable member rewards and Counter-Strike 2 10man modules, a secure owner web panel, durable jobs, and PostgreSQL-backed state.

## What it does

- A compile-time module registry composes Discord commands, interactions, durable jobs, and lifecycle hooks without runtime plugin risk.
- Member Rewards grants idempotent XP for allowlisted text and voice activity, calculates configurable levels, manages level roles, and exposes profiles and leaderboards.
- Guild-tag loyalty tracks continuous use of the server's primary-guild identity and grants a configurable role after the required duration.
- The OAuth-protected `/admin` panel independently configures and toggles modules and records audited manual XP adjustments.
- A persistent Steam-verified queue promotes atomically into one active match per Discord guild.
- A deadline-driven ready check, captain draft, and map veto use signed, stale-safe controls.
- The bot owns and reconciles the queue panel plus per-match text/dashboard resources.
- Parties, queue bans, MatchZy result history, ratings, and audited rollback are durable.
- A durable worker provisions a disposable DatHost server from a protected template.
- The backend builds and loads authenticated MatchZy configuration.
- Discord voice channels reconcile with backend teams.
- MatchZy events persist scores/results and refresh the match dashboard.
- Finish, cancellation, and provisioning failure trigger safe credential, voice, server, and guild-slot cleanup.
- Startup recovery resumes unfinished work, while recurring reconciliation and orphan scans detect missed events and unexplained resources.
- An owner-only web panel at `/admin` configures connected guilds, toggles creation, and runs diagnostics through Discord OAuth.

## Documentation

- [Ubuntu and Discord installation guide](docs/ubuntu-install-guide.md)
- [Architecture](docs/architecture.md)
- [Configuration reference](docs/configuration.md)
- [Discord setup](docs/discord-setup.md)
- [DatHost template setup](docs/dathost-template-setup.md)
- [MatchZy integration](docs/matchzy-integration.md)
- [Permissions matrix](docs/permissions.md)
- [Operations runbook](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Staging acceptance checklist](docs/staging-checklist.md)
- [10man deployment guide](docs/tenman/migration.md)
- [10man state machine](docs/tenman/state-machine.md)
- [10man admin guide](docs/tenman/admin-guide.md)

## Requirements

- Node.js 22 or newer
- Corepack and pnpm 10.15.1
- PostgreSQL
- Discord bot application
- DatHost account and protected MatchZy template
- Public HTTPS origin reachable by Steam and the game server

## Local setup

```bash
cp .env.example .env
# Fill in credentials and public URLs.
corepack pnpm install
corepack pnpm prisma:migrate:deploy
corepack pnpm prisma:seed
corepack pnpm discord:register
corepack pnpm build
corepack pnpm start
```

Slash command registration is explicit; normal application startup does not modify Discord global commands. A native Discord administrator can bootstrap manually with `/match admin configure` or create a managed `10Man` category and channels with `/match admin setup`. Managed resources can be soft-disabled, validated and re-enabled, recovered after interrupted setup, or removed with a signed `/match admin teardown` confirmation.

## Verification

Run under Node 22 with a test/development `DATABASE_URL`:

```bash
corepack pnpm prisma:generate
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm prisma:validate
corepack pnpm test
corepack pnpm build
```

## Ubuntu automated deployment

On a DNS-ready Ubuntu server, clone the repository and run:

```bash
sudo bash scripts/setup-ubuntu.sh
```

The interactive installer installs Docker Engine/Compose and Caddy when missing, generates database and application secrets, writes a mode-600 `.env`, configures automatic HTTPS, builds the image, applies migrations, seeds profiles, registers Discord commands, starts the services, and verifies local and public readiness. It is safe to rerun and automatically retains an existing `.env`.

Before running it, point the chosen domain's DNS records at the server and ensure inbound TCP 80 and 443 are permitted. See the [operations runbook](docs/operations.md) for details and recovery.

## Manual deployment

For a single Docker host:

```bash
docker compose up --build -d
```

Apply migrations, seed profiles, and run `corepack pnpm discord:register` as explicit deployment steps. This release is an initial-schema baseline and must use a new empty database; see the [operations runbook](docs/operations.md) before designing an import for existing data.

The long-running `app` image is production-pruned. For Docker deployments, use
the separate database-tools image after PostgreSQL is healthy:

```bash
docker compose --profile tools run --rm db-tools
docker compose --profile tools run --rm db-tools corepack pnpm prisma:seed
```

The image build uses a non-secret, build-only datasource URL solely to generate
the Prisma client. It never receives the deployment `DATABASE_URL`; the
database-tools service reads that value only at command runtime from `.env`.

## Important invariants

- PostgreSQL permits only one active guild slot.
- A terminal match may continue to own that slot until required cleanup completes.
- DatHost template IDs are never valid disposable cleanup targets.
- Unknown or ambiguous provisioning outcomes are reconciled conservatively.
- Only enabled profiles can be configured or selected.
- Private Steam, connect, diagnostic, and failure details are not posted publicly.

## License

Private — for authorized use only.
