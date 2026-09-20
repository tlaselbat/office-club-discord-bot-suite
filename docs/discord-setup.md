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

A member with Discord's native **Administrator** permission can bootstrap a guild before any bot administrator role has been stored. For automated managed channels, run `/match admin setup` with the three roles and DatHost template on first use. It creates `10Man` with `10man-lobby`, `Lobby`, `Team 1`, and `Team 2`, without permission overwrites.

For existing/manual channels, run:

```text
/match admin configure
```

Provide all four channels, all three roles, the DatHost template server ID, and optionally a DatHost location and enabled game-profile key. The bot validates channel types, channel permissions, role existence, and that the selected profile exists and is enabled before saving.

After setup, either a native Discord administrator or a member with the configured administrator role can reconfigure the guild. Run `/match admin diagnostics` after configuration and whenever channels, roles, or permissions change.

## Slash commands

- `/rewards profile [member]` — show XP, level, rank, and progress to the next configured level.
- `/rewards leaderboard` — show the server's top reward members.
- `/rewards tag-status [member]` — show guild-tag loyalty qualification progress.
- `/10man queue` — create or repair the durable queue panel.
- `/10man status` — show the active match state and ready count.
- `/10man cancel` — cancel the active match; leader, moderator, or administrator only.
- `/steam register` — start Steam OpenID verification.
- `/steam status` — show the current verified SteamID64.
- `/steam replace` — verify a replacement identity; replacement is blocked while the identity is protected by an active locked/live match.
- `/match admin status` — show stored configuration status.
- `/match admin configure` — create or replace guild configuration.
- `/match admin diagnostics` — validate channels, roles, permissions, template access, managed recovery state, and active-match status.
- `/match admin setup` — create and configure the fixed bot-managed category and channels.
- `/match admin recover-setup` — acknowledge/rollback an interrupted setup after inspecting any ambiguous Discord create.
- `/match admin disable` — block new matches without affecting an existing match or deleting resources.
- `/match admin enable` — validate an intact configuration and re-enable new matches.
- `/match admin teardown` — preview and, after a signed five-minute confirmation, delete only persisted bot-managed channels. Active guild slots block teardown.

## Queue and dashboard controls

`/10man queue` repairs the persistent queue panel in the configured lobby text
channel. A full queue is promoted atomically into the deadline-driven ready,
captain, draft, and veto workflow. Queue and match-dashboard controls are
signed and version-bound; use the refreshed panel rather than retrying a stale
component. All slash-command work is acknowledged before slow database,
Discord, or DatHost operations.
