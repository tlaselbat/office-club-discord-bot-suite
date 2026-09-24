# Discord Setup

## Create the application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application and bot.
3. Configure the bot for the gateway capabilities used by the application:
   - Guilds
   - Guild messages
   - Guild voice states
   - Server Members Intent (privileged; required for complete rewards role and guild-tag reconciliation)

The Message Content intent is not required. Member Rewards uses message metadata and never reads or stores message bodies.

1. Copy the bot token to `DISCORD_TOKEN` and the 17-20 digit application ID to `DISCORD_CLIENT_ID`.

## Invite the bot

Generate an invite with these scopes:

```text
bot
applications.commands
```

Grant the bot these channel permissions:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Connect
- Move Members
- Manage Roles (required for configured rewards level and guild-tag roles)
- Manage Channels (required only for managed setup, recovery, and teardown)

The setup validator checks the permissions it needs in each configured channel. See [Permissions](permissions.md) for the application-role authorization model.

## Register slash commands

Command registration is an explicit deployment action and is not performed during normal startup:

```bash
corepack pnpm discord:register
```

Only `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are required by this command. Run it after the first deployment and whenever a module's command definitions changes. Discord global command propagation may not be immediate.

## Prepare the guild

Create:

- One text channel for the persistent match panel.
- One pre-match lobby voice channel.
- Team 1 and Team 2 voice channels.
- A privileged role for match creators.
- A moderator role for match overrides and participant management.
- An administrator role for bot configuration and full override.

## Initial configuration

A member with Discord's native **Administrator** permission can bootstrap a guild before any bot administrator role has been stored. For automated managed channels, run `/match config setup` with the three roles and DatHost template on first use. It creates `Competitive` with `match-queue`, `Match Lobby`, `Team 1`, and `Team 2`, without permission overwrites.

For existing/manual channels, run:

```text
/match config configure
```

Provide all four channels, all three roles, the DatHost template server ID, and optionally a DatHost location and enabled game-profile key. The bot validates channel types, channel permissions, role existence, and that the selected profile exists and is enabled before saving.

After setup, either a native Discord administrator or a member with the configured administrator role can reconfigure the guild. Run `/match admin diagnostics` after configuration and whenever channels, roles, or permissions change.

## Slash commands

- `/rewards profile [member]` — show XP, level, rank, and progress to the next configured level.
- `/rewards leaderboard` — show the server's top reward members.
- `/rewards tag-status [member]` — show guild-tag loyalty qualification progress.
- `/match center` — open your Match Center (queue status, ready check, active match, team status, history, stats).
- `/match account` — review, assign, change, or remove the Steam account reported for Office Club Competitive rosters. Assignment is self-reported and does not verify Steam ownership; changes are blocked while the user is queued or in a live match.
- `/match history [player]` — show recent finished matches; staff also get rollback controls.
- `/match stats [player]` — show rating and record.
- `/match team` — create, invite, accept, leave, kick, or disband a team via an interactive panel.
- `/match alerts enabled:<bool>` — opt in or out of Match Queue fill DM alerts.
- `/match admin match` — ephemeral admin panel for the active match (force ready, restart phase, replace player, stop).
- `/match admin queue` — queue moderation panel (ban/unban via user pickers).
- `/match admin players` — player administration (stats reset via user picker and signed confirmation).
- `/match admin disputes` — pending match-result and Steam-assignment disputes with resolve/reject controls.
- `/match admin diagnostics` — validate channels, roles, permissions, template access, managed recovery state, and active-match status.
- `/match admin queue-panel` — create or repair the persistent Match Queue panel.
- `/match config status` — show stored configuration status.
- `/match config configure` — create or replace guild configuration.
- `/match config setup` — create and configure the fixed bot-managed category and channels.
- `/match config recover-setup` — acknowledge/rollback an interrupted setup after inspecting any ambiguous Discord create.
- `/match config disable` — block new matches without affecting an existing match or deleting resources.
- `/match config enable` — validate an intact configuration and re-enable new matches.
- `/match config teardown` — preview and, after a signed five-minute confirmation, archive and lock only persisted bot-managed channels. It never deletes channels; a Discord administrator may remove archived channels manually. Active guild slots block teardown.

All Office Club Competitive commands reply ephemerally and can be invoked from any guild channel;
authorization is enforced server-side by the configured roles.

## Queue and dashboard controls

`/match admin queue-panel` repairs the persistent Match Queue panel in the configured lobby text
channel. A full queue is promoted atomically into the deadline-driven ready,
captain, draft, and veto workflow. Queue and match-dashboard controls are
signed and version-bound; use the refreshed panel rather than retrying a stale
component. All slash-command work is acknowledged before slow database,
Discord, or DatHost operations.
