# 10man command system

Authoritative description of the registered 10man slash-command surface.

## Design

`/10man` is the player-facing namespace: every subcommand returns an ephemeral
panel with signed, actor-bound components. Staff operations live under
`/10man-admin`; server lifecycle/configuration lives under `/10man-config`.
Discord does not allow a bare top-level command to coexist with subcommands, so
the hub is reached via `/10man hub`.

All commands can be invoked from any guild channel. Authorization is enforced
at execution time by the bot's actor context (leader / participant /
privileged / moderator / configured administrator / native Discord
administrator); Discord command registration is not relied on for access
control. Components re-verify the actor, guild, match version, phase
generation, and expiry before mutating.

No command sets `default_member_permissions`: `/10man-admin` and
`/10man-config` stay visible in the picker, and unauthorized invocations fail
at the backend boundary. Discord's default permission bits cannot express the
configured moderator/administrator role IDs stored in `TenManSettings`, so
hiding these commands would lock out legitimate staff.

## Player commands

| Command                   | Result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `/10man hub`              | Lobby Status panel: queue, ready check, match, party, history, stats |
| `/10man account`          | Steam account panel: assign, review, change, remove, dispute         |
| `/10man history [player]` | Recent finished matches; staff also see rollback controls            |
| `/10man stats [player]`   | Rating and record                                                    |
| `/10man party`            | Party panel: create, invite, accept, leave, kick, disband            |
| `/10man alerts <enabled>` | Opt in/out of queue-fill DM alerts                                   |

## Staff commands (`/10man-admin`)

| Command                    | Result                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `/10man-admin match`       | Active-match panel: force ready, restart phase, replace, stop   |
| `/10man-admin queue`       | Queue moderation: ban/unban via user pickers and a reason modal |
| `/10man-admin players`     | Player stats reset via user picker + signed confirmation        |
| `/10man-admin disputes`    | Pending result and Steam-assignment disputes with controls      |
| `/10man-admin diagnostics` | Channels, roles, permissions, template, managed state           |
| `/10man-admin queue-panel` | Create or repair the persistent lobby queue panel               |

## Configuration commands (`/10man-config`)

`status`, `setup`, `configure`, `enable`, `disable`, `teardown`,
`recover-setup`. `setup` works before managed channels exist; all of these
require the configured administrator role or native Discord Administrator.

## Migration from the previous command tree

The legacy top-level commands `/steam`, `/match`, `/player`, and `/party` are
removed outright — no compatibility aliases are registered. Global command
propagation removes them from Discord clients within roughly an hour of
registration.

| Legacy command                        | Now                                                     |
| ------------------------------------- | ------------------------------------------------------- |
| `/10man queue`                        | `/10man-admin queue-panel`                              |
| `/10man hub`                          | `/10man hub` (unchanged)                                |
| `/10man status`                       | `/10man hub` (derives state)                            |
| `/10man cancel`                       | hub **Cancel Match…** button / `/10man-admin match`     |
| `/10man alerts`                       | `/10man alerts` (unchanged)                             |
| `/steam account`                      | `/10man account`                                        |
| `/match history`                      | `/10man history`                                        |
| `/match admin status`                 | `/10man-config status`                                  |
| `/match admin diagnostics`            | `/10man-admin diagnostics`                              |
| `/match admin panel`                  | `/10man-admin match`                                    |
| `/match admin force-ready`            | `/10man-admin match` → Force Ready                      |
| `/match admin restart-phase`          | `/10man-admin match` → Restart Phase…                   |
| `/match admin reset-player-stats`     | `/10man-admin players` → user picker                    |
| `/match admin replace-player`         | `/10man-admin match` → two-step replace picker          |
| `/match admin rollback`               | `/10man history` → staff Rollback button                |
| `/match admin queue-ban`              | `/10man-admin queue` → ban picker + modal               |
| `/match admin queue-unban`            | `/10man-admin queue` → unban picker                     |
| `/match admin result-disputes`        | `/10man-admin disputes`                                 |
| `/match admin resolve-result-dispute` | `/10man-admin disputes` → Reverse/Reject + reason modal |
| `/match admin steam-disputes`         | `/10man-admin disputes`                                 |
| `/match admin resolve-steam-dispute`  | `/10man-admin disputes` → Resolve/Reject                |
| `/match admin setup/configure/…`      | `/10man-config …`                                       |
| `/player stats`                       | `/10man stats`                                          |
| `/player matches`                     | `/10man history`                                        |
| `/party create`                       | `/10man party` → Create Party                           |
| `/party invite`                       | `/10man party` → invite user picker                     |
| `/party accept`                       | DM/panel **Accept Invitation** button                   |
| `/party leave`                        | `/10man party` → Leave Party                            |
| `/party kick`                         | `/10man party` → remove-member picker                   |
| `/party disband`                      | `/10man party` → Disband Party                          |

Raw `party_id`, `invite_id`, `match_id`, and `dispute_id` command options are
eliminated; identifiers only exist inside signed component custom IDs.
