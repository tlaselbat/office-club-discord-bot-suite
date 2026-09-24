# Office Club Competitive command system

Authoritative description of the registered `/match` slash-command surface.

## Design

`/match` is the consolidated command root for Office Club Competitive. Player
commands are exposed as direct subcommands. Staff operations live under the
`/match admin` subcommand group. Server lifecycle and configuration live under
`/match config`.

Discord does not allow a bare top-level command to coexist with subcommands, so
the Match Center is reached explicitly via `/match center`.

All commands can be invoked from any guild channel. Authorization is enforced
at execution time by the bot's actor context (leader / participant /
privileged / moderator / configured administrator / native Discord
administrator); Discord command registration is not relied on for access
control. Components re-verify the actor, guild, match version, phase
generation, and expiry before mutating.

No command sets `default_member_permissions`: `/match admin` and
`/match config` stay visible in the picker, and unauthorized invocations fail
at the backend boundary. Discord's default permission bits cannot express the
configured moderator/administrator role IDs stored in `TenManSettings`, so
hiding these commands would lock out legitimate staff.

## Player commands

| Command                   | Result                                                                      |
| ------------------------- | --------------------------------------------------------------------------- |
| `/match center`           | Match Center: queue status, ready check, active match, team, history, stats |
| `/match account`          | Steam account panel: assign, review, change, remove, dispute                |
| `/match history [player]` | Recent finished matches; staff also see rollback controls                   |
| `/match stats [player]`   | Rating and record                                                           |
| `/match team`             | Team Status panel: create, invite, accept, leave, kick, disband             |
| `/match alerts <enabled>` | Opt in/out of Match Queue fill DM alerts                                    |

## Staff commands (`/match admin`)

| Command                    | Result                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `/match admin match`       | Active-match panel: force ready, restart phase, replace, stop   |
| `/match admin queue`       | Queue moderation: ban/unban via user pickers and a reason modal |
| `/match admin players`     | Player stats reset via user picker + signed confirmation        |
| `/match admin disputes`    | Pending result and Steam-assignment disputes with controls      |
| `/match admin diagnostics` | Channels, roles, permissions, template, managed state           |
| `/match admin queue-panel` | Create or repair the persistent Match Queue panel               |

## Configuration commands (`/match config`)

`/match config status`, `/match config setup`, `/match config configure`,
`/match config enable`, `/match config disable`, `/match config teardown`,
`/match config recover-setup`. `setup` works before managed channels exist; all
of these require the configured administrator role or native Discord
Administrator.

## Migration from the previous command tree

The legacy top-level commands `/10man`, `/10man-admin`, `/10man-config`,
`/steam`, `/match`, `/player`, and `/party` are removed outright — no
compatibility aliases are registered. Global command propagation removes them
from Discord clients within roughly an hour of registration.

| Legacy command                        | Now                                                     |
| ------------------------------------- | ------------------------------------------------------- |
| `/10man`                              | `/match`                                                |
| `/10man hub`                          | `/match center`                                         |
| `/10man account`                      | `/match account`                                        |
| `/10man history`                      | `/match history`                                        |
| `/10man stats`                        | `/match stats`                                          |
| `/10man party`                        | `/match team`                                           |
| `/10man alerts`                       | `/match alerts`                                         |
| `/10man-admin match`                  | `/match admin match`                                    |
| `/10man-admin queue`                  | `/match admin queue`                                    |
| `/10man-admin players`                | `/match admin players`                                  |
| `/10man-admin disputes`               | `/match admin disputes`                                 |
| `/10man-admin diagnostics`            | `/match admin diagnostics`                              |
| `/10man-admin queue-panel`            | `/match admin queue-panel`                              |
| `/10man-config status`                | `/match config status`                                  |
| `/10man-config setup`                 | `/match config setup`                                   |
| `/10man-config configure`             | `/match config configure`                               |
| `/10man-config enable`                | `/match config enable`                                  |
| `/10man-config disable`               | `/match config disable`                                 |
| `/10man-config teardown`              | `/match config teardown`                                |
| `/10man-config recover-setup`         | `/match config recover-setup`                           |
| `/steam account`                      | `/match account`                                        |
| `/match history`                      | `/match history`                                        |
| `/match admin diagnostics`            | `/match admin diagnostics`                              |
| `/match admin panel`                  | `/match admin match`                                    |
| `/match admin force-ready`            | `/match admin match` → Force Ready                      |
| `/match admin restart-phase`          | `/match admin match` → Restart Phase…                   |
| `/match admin reset-player-stats`     | `/match admin players` → user picker                    |
| `/match admin replace-player`         | `/match admin match` → two-step replace picker          |
| `/match admin rollback`               | `/match history` → staff Rollback button                |
| `/match admin queue-ban`              | `/match admin queue` → ban picker + modal               |
| `/match admin queue-unban`            | `/match admin queue` → unban picker                     |
| `/match admin result-disputes`        | `/match admin disputes`                                 |
| `/match admin resolve-result-dispute` | `/match admin disputes` → Reverse/Reject + reason modal |
| `/match admin steam-disputes`         | `/match admin disputes`                                 |
| `/match admin resolve-steam-dispute`  | `/match admin disputes` → Resolve/Reject                |
| `/match admin setup/configure/…`      | `/match config …`                                       |
| `/player stats`                       | `/match stats`                                          |
| `/player matches`                     | `/match history`                                        |
| `/party create`                       | `/match team` → Create Team                             |
| `/party invite`                       | `/match team` → invite user picker                      |
| `/party accept`                       | DM/panel **Accept Team Invitation** button              |
| `/party leave`                        | `/match team` → Leave Team                              |
| `/party kick`                         | `/match team` → remove-member picker                    |
| `/party disband`                      | `/match team` → Disband Team                            |

Raw `party_id`, `invite_id`, `match_id`, and `dispute_id` command options are
eliminated; identifiers only exist inside signed component custom IDs.
