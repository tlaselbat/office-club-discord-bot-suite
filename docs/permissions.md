# Permissions Matrix

## Authorization sources

The bot uses configured Discord role IDs for normal authorization. Discord's native Administrator permission is additionally accepted for initial and later guild configuration, allowing first-time setup before a bot administrator role exists.

| Identity                     | Purpose                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Participant                  | Joined the active match with an assigned Steam identity                                                         |
| Leader                       | Participant identified by `leaderDiscordUserId`                                                                 |
| Privileged member            | Configured role allowed to create matches and view active details                                               |
| Moderator                    | Configured role with leader controls, participant management, transfer, and diagnostics                         |
| Administrator                | Configured role with all bot actions                                                                            |
| Native Discord administrator | Can bootstrap/reconfigure the guild; other actions still derive from the bot actor context and configured roles |

## Match actions

| Action                                       | Participant | Leader | Privileged | Moderator                           | Administrator              |
| -------------------------------------------- | ----------- | ------ | ---------- | ----------------------------------- | -------------------------- |
| View `/10man status`                         | yes         | yes    | yes        | yes                                 | yes                        |
| Get private connect information              | yes         | yes    | yes        | only if also participant/privileged | yes                        |
| Join when not already participating          | yes         | yes    | yes        | yes                                 | yes                        |
| Leave / ready                                | yes         | yes    | no         | only if participating               | yes                        |
| Create match                                 | no          | no     | yes        | yes                                 | yes                        |
| Organize teams / select map or profile       | no          | yes    | no         | yes                                 | yes                        |
| Lock teams                                   | no          | yes    | no         | yes                                 | yes                        |
| Force start / pause / resume / restore / end | no          | yes    | no         | yes                                 | yes                        |
| Cancel match                                 | no          | yes    | no         | yes                                 | yes                        |
| Transfer leader / remove participant         | no          | no     | no         | yes                                 | yes                        |
| Configure guild                              | no          | no     | no         | no                                  | configured or native admin |
| Setup/recover/disable/enable/teardown        | no          | no     | no         | no                                  | configured or native admin |
| Run diagnostics                              | no          | no     | no         | yes                                 | yes                        |

Joining also requires an assigned Steam identity (self-reported, not ownership-verified) and available profile capacity. Team controls remain server-authorized even though Discord user selectors can display users outside the match.

## Bot channel permissions

Configuration verifies:

### Lobby text channel

- View Channel
- Send Messages
- Embed Links
- Read Message History

### Lobby and team voice channels

- View Channel
- Connect
- Move Members

Managed setup, setup recovery, and teardown additionally require guild-level **Manage Channels**. Manual configuration and normal match operation do not use that permission.

The bot does not currently require Speak for its implemented voice behavior. If server-level or category overrides deny one of these permissions, configuration or diagnostics reports the affected channel.

### Member Rewards roles

The bot requires **Manage Roles** to grant or remove configured level and guild-tag roles. Every configured reward role must be unmanaged and lower than the bot's highest role. The rewards service changes only roles explicitly configured for that module.

Text rewards require access to guild message events but not Message Content. Voice rewards use connection state only. Complete startup and guild-tag reconciliation requires the privileged **Server Members Intent** in the Developer Portal.

The owner allowlist controlling `/admin` may save reward settings, toggle Member Rewards, and issue audited manual XP adjustments. Member-facing reward commands are read-only.

## Discord application scopes

The invite must include:

- `bot`
- `applications.commands`

Command registration additionally requires a valid application ID and bot token for the same application.

## DatHost access

The configured account must be able to:

- List and inspect servers for recovery and diagnostics.
- Create a provisional CS2 destination.
- Duplicate the configured template into that destination.
- Configure and start the disposable destination.
- Send allowlisted MatchZy console commands.
- Stop and delete positively identified bot-owned disposable servers.

The application refuses to configure or delete protected template IDs and verifies disposable ownership before cleanup.
