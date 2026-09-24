# Office Club Discord Bot Suite

A Discord bot for Office Club communities: member rewards and a managed Counter-Strike 2 10man experience, backed by PostgreSQL and an owner-only web panel.

> **Release status:** beta. The core 10man and rewards systems are implemented, but every deployment should complete the [staging acceptance checklist](docs/staging-checklist.md) before it is relied on for live matches.

## Contents

- [What members can do](#what-members-can-do)
- [Using the bot](#using-the-bot)
- [What server staff can do](#what-server-staff-can-do)
- [Getting started as a server owner](#getting-started-as-a-server-owner)
- [Documentation](#documentation)
- [Milestones](#milestones)
- [Development and verification](#development-and-verification)

## What members can do

### Earn rewards

When the **Member Rewards** module is enabled, members earn configurable XP for activity in approved text and voice channels. The module can assign level roles and track progress toward a server guild-tag loyalty role. Message content is not requested or stored.

### Play CS2 10mans

When the **10man** module is configured, Steam-assigned players can form a party, join the persistent lobby queue, accept a ready check, draft teams, veto maps, and play on a disposable DatHost CS2 server controlled by MatchZy. Queue state, match state, results, and cleanup work survive bot restarts.

The initial supported competitive format is **BO1, 5v5, ten Steam-assigned players, and one GOTV slot**. Points and win/loss records are tracked; they are not calibrated matchmaking ratings.

## Using the bot

### Member Rewards commands

| Command                        | Use it to                                                |
| ------------------------------ | -------------------------------------------------------- |
| `/rewards profile [member]`    | View XP, level, and rank for yourself or another member. |
| `/rewards leaderboard [page]`  | View the rewards leaderboard.                            |
| `/rewards tag-status [member]` | Check guild-tag loyalty progress.                        |

### Player 10man commands

| Command                   | Use it to                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `/10man hub`              | Open the Lobby Status panel for the queue, active match, party, history, and stats. |
| `/10man account`          | Add, review, change, remove, or dispute a Steam account assignment.                 |
| `/10man party`            | Create and manage a party, including invites and membership.                        |
| `/10man history [player]` | View recent finished matches.                                                       |
| `/10man stats [player]`   | View a player's points and record.                                                  |
| `/10man alerts <enabled>` | Opt in or out of queue-fill direct-message alerts.                                  |

Most player actions happen in signed buttons and pickers inside these private panels. Follow the buttons in `/10man hub` rather than looking for separate queue, draft, or veto commands.

### A typical 10man

1. Use `/10man account` to connect your Steam identity.
2. Open `/10man hub`, then join the lobby queue. Join with your party if applicable.
3. Accept the ready check when the queue fills.
4. Captains are selected, then draft players and veto maps through the match panel.
5. Once the server is ready, eligible participants use the private **My Match Info** control for connection details.
6. Play the match. MatchZy reports the outcome, the dashboard updates, and the bot cleans up the temporary resources.

## What server staff can do

### 10man administration

| Command                    | Use it to                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/10man-admin match`       | Inspect the active match and use signed staff controls such as force-ready, phase restart, replacement, or stop. |
| `/10man-admin queue`       | Ban or unban players from the queue with a recorded reason.                                                      |
| `/10man-admin players`     | Reset player statistics after a signed confirmation.                                                             |
| `/10man-admin disputes`    | Review result and Steam-assignment disputes.                                                                     |
| `/10man-admin diagnostics` | Check channels, roles, permissions, templates, and managed-resource state.                                       |
| `/10man-admin queue-panel` | Create or repair the persistent lobby queue panel.                                                               |

### 10man configuration

`/10man-config` provides `status`, `setup`, `configure`, `enable`, `disable`, `teardown`, and `recover-setup`.

Initial configuration requires Discord's native **Administrator** permission. After setup, the configured 10man administrator role may also manage configuration. Staff commands remain visible in Discord so configured role-based access works correctly; the bot verifies authorization every time an action is performed.

### Owner web panel

At `https://<your-domain>/admin`, approved Discord owner accounts can configure connected guilds, enable or disable modules, manage Member Rewards settings, make audited manual XP adjustments, and run diagnostics. Access uses Discord OAuth and is restricted to the IDs in `PANEL_OWNER_DISCORD_USER_IDS`.

## Getting started as a server owner

### Before you install

You need:

- Node.js 22+ with Corepack and pnpm 10.15.1
- PostgreSQL and a **fresh, disposable database** for the current clean migration baseline
- A Discord application and bot
- A DatHost account with a protected CS2 + MatchZy template
- A public HTTPS URL reachable by the MatchZy server

For a detailed walkthrough, start with the [Ubuntu and Discord installation guide](docs/ubuntu-install-guide.md).

### Local setup

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

Slash-command registration is intentional and separate from normal startup. After inviting the bot, configure a guild with `/10man-config configure`, or use `/10man-config setup` to create the managed `10Man` category and channels. Run `/10man-admin diagnostics` before enabling live matches.

Do not put credentials in source control, Discord messages, screenshots, or public issue reports. See the [configuration reference](docs/configuration.md) for every required value and the exact OAuth callback URL.

### Production deployment

On a DNS-ready Ubuntu server, the supported automated path is:

```bash
sudo bash scripts/setup-ubuntu.sh
```

The installer configures Docker, PostgreSQL, Caddy HTTPS, a protected `.env`, migrations, seed data, command registration, and readiness checks. For manual Docker deployment and recovery procedures, use the [operations runbook](docs/operations.md).

## Documentation

### Owners and operators

- [Ubuntu and Discord installation guide](docs/ubuntu-install-guide.md)
- [Configuration reference](docs/configuration.md)
- [Discord setup](docs/discord-setup.md)
- [DatHost template setup](docs/dathost-template-setup.md)
- [MatchZy integration](docs/matchzy-integration.md)
- [Permissions matrix](docs/permissions.md)
- [Operations runbook](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Staging acceptance checklist](docs/staging-checklist.md)

### 10man reference

- [Player, staff, and configuration command reference](docs/tenman/commands.md)
- [10man admin guide](docs/tenman/admin-guide.md)
- [10man state machine](docs/tenman/state-machine.md)
- [10man deployment and database baseline guide](docs/tenman/migration.md)
- [Architecture](docs/architecture.md)

## Milestones

### Completed in the beta baseline

- [x] Modular Discord bot with independently configurable Member Rewards and 10man modules.
- [x] Rewards, levels, role assignment, leaderboards, and guild-tag loyalty tracking.
- [x] Durable Steam-assigned 10man queue, parties, ready checks, captain draft, map veto, and match history.
- [x] Protected DatHost template provisioning, authenticated MatchZy integration, voice reconciliation, result persistence, and safe cleanup/recovery.
- [x] Owner-only Discord OAuth panel, auditable administration, diagnostics, and managed Discord resource lifecycle.
- [x] Player-facing 10man hub, grouped match dashboard, private participant-only match connection details, and queue alerts.

### Before a live-server release

- [ ] Run the full [staging acceptance checklist](docs/staging-checklist.md) against a real protected template, disposable server, and public HTTPS endpoint.
- [ ] Capture redacted evidence for a complete match lifecycle: queue, ready check, draft, veto, provisioning, results, cleanup, and restart recovery.
- [ ] Confirm operational ownership: backups, secret rotation, monitoring, and incident response.

### Planned after the release gate

- [ ] Define a retained-results channel and receipt lifecycle.
- [ ] Choose a private object-storage and retention policy before enabling demo collection.
- [ ] Add demo transfer, integrity verification, authorized access, and cleanup-deadline handling only after that policy is staged.
- [ ] Consider further opt-in history and queue convenience improvements after the core lifecycle is proven stable.

The [10man QoL implementation plan](docs/tenman/qol-implementation-plan.md) defines the scope and safety gates for these follow-up items.

## Development and verification

Use Node 22 with a development or test `DATABASE_URL`:

```bash
corepack pnpm prisma:generate
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm prisma:validate
corepack pnpm test
corepack pnpm build
```

For database coverage, point `TEST_DATABASE_URL` at an isolated migrated test database and run:

```bash
corepack pnpm test:database
```

## License

Private — for authorized use only.
