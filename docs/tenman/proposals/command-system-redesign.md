# 10man Slash-Command Redesign Proposal

> **Status: IMPLEMENTED — ARCHIVED.**
>
> The implemented, authoritative command tree is documented in
> `docs/tenman/commands.md`. This file is retained as design history only.
>
> Implemented deviations from this proposal:
>
> - Discord does not allow a bare top-level command to coexist with
>   subcommands, so the hub entry point is `/10man hub` rather than a bare
>   `/10man`.
> - Staff operations are split into two sibling top-level commands,
>   `/10man-admin` (match/queue/players/disputes/diagnostics/queue-panel) and
>   `/10man-config` (status/setup/configure/enable/disable/teardown/
>   recover-setup), because a command cannot mix subcommands and
>   subcommand-groups under one root.
> - No compatibility aliases are retained: `/steam`, `/match`, `/player`, and
>   `/party` were removed outright per this proposal's no-duplicate-namespaces
>   rule. Global command propagation removes them from clients.
> - The managed-channel invocation gate was removed entirely; every command is
>   ephemeral and authorizes at execution time.

## Goals

- One obvious top-level namespace for the 10man module: `/10man`.
- Slash commands are entry points and shortcuts; persistent panels, buttons, modals, and the `My 10man` hub remain the primary player interface.
- Ordinary players should need almost no command knowledge.
- Staff commands are grouped by concept, not by permission level.
- No raw implementation identifiers (`party_id`, `invite_id`, `match_id`, `dispute_id`) are required from ordinary users or from staff in normal workflows.
- Channel restrictions exist only where they serve a concrete purpose.

---

## 1. Current command inventory

| Top level      | Subcommand / group       | Options                                                                                                                                            | Who can run              | Channel restriction   | Behavior                               |
| -------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------- | -------------------------------------- |
| `/10man`       | (none)                   | —                                                                                                                                                  | any member               | managed 10man channel | not implemented                        |
| `/10man`       | `queue`                  | —                                                                                                                                                  | any member               | managed 10man channel | create/repair persistent queue panel   |
| `/10man`       | `hub`                    | —                                                                                                                                                  | any member               | managed 10man channel | open personal 10man hub                |
| `/10man`       | `status`                 | —                                                                                                                                                  | any member               | managed 10man channel | text dump of active match              |
| `/10man`       | `cancel`                 | —                                                                                                                                                  | match leader / moderator | managed 10man channel | cancel active match                    |
| `/10man`       | `alerts`                 | `enabled` (bool, required)                                                                                                                         | any member               | managed 10man channel | opt in/out of DM queue alerts          |
| `/steam`       | `account`                | —                                                                                                                                                  | any member               | managed 10man channel | open Steam-account UI                  |
| `/match`       | `history`                | `player` (user, optional)                                                                                                                          | any member               | managed 10man channel | recent finished matches text           |
| `/match admin` | `status`                 | —                                                                                                                                                  | administrator            | managed 10man channel | configuration status text              |
| `/match admin` | `setup`                  | `privileged_role`, `moderator_role`, `administrator_role`, `dathost_template_server_id`, `dathost_location`, `default_game_profile` (all optional) | administrator            | **none** (bootstrap)  | create managed channels/roles          |
| `/match admin` | `configure`              | lobby/voice channels, roles, template, location, profile, queue_size, ready_timeout, party_enabled, team_selection, map_selection, results_channel | administrator            | managed 10man channel | update server settings                 |
| `/match admin` | `recover-setup`          | —                                                                                                                                                  | administrator            | managed 10man channel | recover interrupted setup              |
| `/match admin` | `disable`                | —                                                                                                                                                  | administrator            | managed 10man channel | disable new matches                    |
| `/match admin` | `enable`                 | —                                                                                                                                                  | administrator            | managed 10man channel | re-enable                              |
| `/match admin` | `teardown`               | —                                                                                                                                                  | administrator            | managed 10man channel | archive managed channels               |
| `/match admin` | `diagnostics`            | —                                                                                                                                                  | administrator            | managed 10man channel | run diagnostics                        |
| `/match admin` | `panel`                  | —                                                                                                                                                  | moderator                | managed 10man channel | ephemeral active-match admin panel     |
| `/match admin` | `force-ready`            | —                                                                                                                                                  | moderator                | managed 10man channel | force ready check forward              |
| `/match admin` | `restart-phase`          | —                                                                                                                                                  | moderator                | managed 10man channel | restart forming phase                  |
| `/match admin` | `reset-player-stats`     | `player` (user, required)                                                                                                                          | moderator                | managed 10man channel | reset player rating/record             |
| `/match admin` | `replace-player`         | `outgoing`, `incoming` (users, required)                                                                                                           | moderator                | managed 10man channel | replace participant during ready check |
| `/match admin` | `rollback`               | `match_id` (string UUID, required)                                                                                                                 | moderator                | managed 10man channel | reverse applied result                 |
| `/match admin` | `queue-ban`              | `player`, `reason` (required), `duration_minutes`                                                                                                  | moderator                | managed 10man channel | ban from queue                         |
| `/match admin` | `queue-unban`            | `player` (required)                                                                                                                                | moderator                | managed 10man channel | revoke queue ban                       |
| `/match admin` | `result-disputes`        | —                                                                                                                                                  | moderator                | managed 10man channel | list pending result disputes           |
| `/match admin` | `resolve-result-dispute` | `dispute_id`, `action`, `reason` (required)                                                                                                        | moderator                | managed 10man channel | resolve result dispute                 |
| `/match admin` | `steam-disputes`         | —                                                                                                                                                  | moderator                | managed 10man channel | list pending Steam disputes            |
| `/match admin` | `resolve-steam-dispute`  | `dispute_id`, `action`, `reason` (required)                                                                                                        | moderator                | managed 10man channel | resolve Steam dispute                  |
| `/player`      | `stats`                  | `player` (user, optional)                                                                                                                          | any member               | managed 10man channel | rating/record text                     |
| `/player`      | `matches`                | `player` (user, optional)                                                                                                                          | any member               | managed 10man channel | recent matches text                    |
| `/party`       | `create`                 | —                                                                                                                                                  | any member               | managed 10man channel | create party, return UUID              |
| `/party`       | `invite`                 | `party_id` (string UUID, required), `player` (user, required)                                                                                      | any member               | managed 10man channel | create invite, return UUID             |
| `/party`       | `accept`                 | `invite_id` (string UUID, required)                                                                                                                | any member               | managed 10man channel | accept invitation                      |
| `/party`       | `leave`                  | `party_id` (string UUID, required)                                                                                                                 | any member               | managed 10man channel | leave party                            |
| `/party`       | `kick`                   | `party_id` (string UUID, required), `player` (user, required)                                                                                      | any member               | managed 10man channel | kick party member                      |
| `/party`       | `disband`                | `party_id` (string UUID, required)                                                                                                                 | any member               | managed 10man channel | disband party                          |

---

## 2. Problems found

### 2.1 Namespace fragmentation

- Player-facing features are split across `/10man`, `/steam`, `/match`, `/player`, and `/party`.
- A new player cannot guess whether Steam management is under `/10man`, `/steam`, or `/player`.
- `/match` contains both player information (`history`) and a large administrative group.

### 2.2 `/match` is conceptually overloaded

It currently mixes:

- historical/player info (`history`);
- server configuration (`setup`, `configure`, `enable`, `disable`, `teardown`, `recover-setup`);
- live-match moderation (`panel`, `force-ready`, `restart-phase`, `replace-player`, `rollback`);
- queue moderation (`queue-ban`, `queue-unban`);
- player administration (`reset-player-stats`);
- dispute resolution (`result-disputes`, `resolve-result-dispute`, `steam-disputes`, `resolve-steam-dispute`);
- diagnostics (`diagnostics`).

### 2.3 `/player` duplicates `/match history`

`stats` and `matches` are both player-information queries and should live near other personal commands.

### 2.4 Party commands expose implementation identifiers

`party_id` and `invite_id` are required. Ordinary users should select users and confirm via buttons, not paste UUIDs.

### 2.5 Staff rollback requires a raw `match_id`

Finished matches should be selectable from an interactive history view or admin disputes panel, not by UUID.

### 2.6 Dispute resolution requires raw `dispute_id`

Disputes should be listed with signed Resolve/Reject buttons on each row.

### 2.7 Some commands return text dumps instead of opening the GUI

- `/10man status` prints state instead of opening the hub or active match panel.
- `/player stats` and `/player matches` print text instead of opening the history/stats view.

### 2.8 `/10man queue` is ambiguous

It sounds like a player action but actually creates/repairs the persistent panel and should be staff-only.

### 2.9 `/steam` is an extra top-level namespace

Steam-account assignment is part of a player's 10man account, not a separate system.

### 2.10 Channel restrictions are too broad

Personal commands (`hub`, `account`, `history`, `alerts`) are currently restricted to managed 10man channels. That forces players to leave DMs or other channels to check their own status.

### 2.11 Terminology inconsistencies

- `setup` vs `configure` are easily confused.
- `register`/`replace` legacy names were already removed; the remaining surface still mixes "setup", "configure", "panel", and admin terms.

---

## 3. Proposed final command tree

All 10man functionality lives under **`/10man`**. Two subcommand groups separate staff concerns:

- **`/10man admin`** — moderation and current-match operations.
- **`/10man config`** — server setup, configuration, and lifecycle.

### 3.1 Player commands

```text
/10man
  → Open My 10man hub (ephemeral player panel).

/10man alerts enabled:<boolean>
  → Opt in or out of DM queue-fill alerts.

/10man account
  → Open Steam account management UI.

/10man history [player:<user>]
  → Open recent finished matches view (defaults to caller).

/10man stats [player:<user>]
  → Open player rating/record view (defaults to caller).

/10man party
  → Open party management panel (only if parties are enabled).
```

### 3.2 Staff commands — `/10man admin`

```text
/10man admin match
  → Open active match admin panel (force ready, restart phase, replace player, stop).

/10man admin queue
  → Open queue moderation panel (ban/unban, clear, etc.).

/10man admin players
  → Open player administration panel (reset stats, view bans, etc.).

/10man admin disputes
  → Open disputes inbox (Steam + result disputes with Resolve/Reject buttons).

/10man admin diagnostics
  → Run safe diagnostics and return report.
```

### 3.3 Configuration commands — `/10man config`

```text
/10man config setup
  [privileged_role:<role>]
  [moderator_role:<role>]
  [administrator_role:<role>]
  [dathost_template_server_id:<string>]
  [dathost_location:<string>]
  [default_game_profile:<string>]
  → Bootstrap: create managed channels/roles.

/10man config configure
  lobby_text_channel:<channel>
  lobby_voice_channel:<channel>
  team1_voice_channel:<channel>
  team2_voice_channel:<channel>
  privileged_role:<role>
  moderator_role:<role>
  administrator_role:<role>
  dathost_template_server_id:<string>
  [results_channel:<channel>]
  [dathost_location:<string>]
  [default_game_profile:<string>]
  [queue_size:<integer>]
  [ready_timeout_seconds:<integer>]
  [party_enabled:<boolean>]
  [team_selection:<Captains|Random teams>]
  [map_selection:<Captain veto|Random map>]
  → Update server settings.

/10man config status
  → Show configuration summary.

/10man config enable
  → Enable new 10man creation.

/10man config disable
  → Disable new 10man creation.

/10man config teardown
  → Archive managed channels.

/10man config recover-setup
  → Recover interrupted managed setup.

/10man admin queue-panel
  → Repost/repair the persistent queue panel.
```

### 3.4 Commands removed

- `/10man hub` — replaced by root `/10man`.
- `/10man status` — replaced by hub / active match panel.
- `/10man cancel` — replaced by match dashboard stop button and `/10man admin match`.
- `/steam account` — moved to `/10man account`.
- `/match` — removed entirely.
- `/match history` — moved to `/10man history`.
- `/player` — removed entirely.
- `/player stats` — moved to `/10man stats`.
- `/player matches` — moved to `/10man history`.
- `/party` — removed; replaced by `/10man party` panel and buttons.
- `/match admin panel` → `/10man admin match`.
- `/match admin force-ready` → button in `/10man admin match`.
- `/match admin restart-phase` → button in `/10man admin match`.
- `/match admin replace-player` → control in `/10man admin match`.
- `/match admin rollback` → action reachable from staff history view or disputes panel.
- `/match admin queue-ban` / `queue-unban` → `/10man admin queue`.
- `/match admin reset-player-stats` → `/10man admin players`.
- `/match admin result-disputes` / `resolve-result-dispute` → `/10man admin disputes`.
- `/match admin steam-disputes` / `resolve-steam-dispute` → `/10man admin disputes`.
- `/match admin status` / `setup` / `configure` / `enable` / `disable` / `teardown` / `recover-setup` / `diagnostics` → `/10man config ...` or `/10man admin diagnostics`.

---

## 4. Command migration matrix

| Current command                       | Proposed command / surface                         | Treatment        | Reason                                |
| ------------------------------------- | -------------------------------------------------- | ---------------- | ------------------------------------- |
| `/10man` (root)                       | `/10man`                                           | Keep behavior    | Root opens hub                        |
| `/10man queue`                        | `/10man admin queue-panel`                         | Move & restrict  | Panel repair is staff-only            |
| `/10man hub`                          | `/10man`                                           | Remove           | Redundant with root                   |
| `/10man status`                       | My 10man hub / match panel                         | Replace          | GUI shows state                       |
| `/10man cancel`                       | Match dashboard stop button / `/10man admin match` | Replace          | Leaders already have panel control    |
| `/10man alerts`                       | `/10man alerts`                                    | Keep             | Personal preference command           |
| `/steam account`                      | `/10man account`                                   | Move             | Single player namespace               |
| `/match history`                      | `/10man history`                                   | Move/consolidate | Avoid `/match` for player info        |
| `/player stats`                       | `/10man stats`                                     | Move/consolidate | Avoid separate `/player` tree         |
| `/player matches`                     | `/10man history`                                   | Move/consolidate | Matches are history                   |
| `/party create`                       | `/10man party` Create button                       | Replace          | Panel-driven                          |
| `/party invite`                       | `/10man party` user select                         | Replace          | No UUID needed                        |
| `/party accept`                       | Invitation message button                          | Replace          | No UUID needed                        |
| `/party leave`                        | `/10man party` Leave button                        | Replace          | Panel-driven                          |
| `/party kick`                         | `/10man party` Kick select                         | Replace          | No UUID needed                        |
| `/party disband`                      | `/10man party` Disband button                      | Replace          | Panel-driven                          |
| `/match admin status`                 | `/10man config status`                             | Move             | Config status belongs to config group |
| `/match admin setup`                  | `/10man config setup`                              | Move             | Bootstrap config                      |
| `/match admin configure`              | `/10man config configure`                          | Move             | Settings update                       |
| `/match admin recover-setup`          | `/10man config recover-setup`                      | Move             | Config recovery                       |
| `/match admin enable`                 | `/10man config enable`                             | Move             | Lifecycle toggle                      |
| `/match admin disable`                | `/10man config disable`                            | Move             | Lifecycle toggle                      |
| `/match admin teardown`               | `/10man config teardown`                           | Move             | Lifecycle action                      |
| `/match admin diagnostics`            | `/10man admin diagnostics`                         | Move             | Operational check, not config         |
| `/match admin panel`                  | `/10man admin match`                               | Rename/replace   | Open match admin panel                |
| `/match admin force-ready`            | `/10man admin match` button                        | Replace          | Contextual control                    |
| `/match admin restart-phase`          | `/10man admin match` button                        | Replace          | Contextual control                    |
| `/match admin replace-player`         | `/10man admin match` control                       | Replace          | Select users in panel                 |
| `/match admin rollback`               | Staff history view / disputes panel                | Replace          | Avoid raw match_id                    |
| `/match admin reset-player-stats`     | `/10man admin players`                             | Move             | Player admin, not match admin         |
| `/match admin queue-ban`              | `/10man admin queue`                               | Move             | Queue moderation group                |
| `/match admin queue-unban`            | `/10man admin queue`                               | Move             | Queue moderation group                |
| `/match admin result-disputes`        | `/10man admin disputes`                            | Consolidate      | Single disputes inbox                 |
| `/match admin resolve-result-dispute` | `/10man admin disputes` button                     | Replace          | No dispute_id needed                  |
| `/match admin steam-disputes`         | `/10man admin disputes`                            | Consolidate      | Single disputes inbox                 |
| `/match admin resolve-steam-dispute`  | `/10man admin disputes` button                     | Replace          | No dispute_id needed                  |

---

## 5. Interaction behavior for every surviving command

| Command                            | Interaction result                                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10man`                           | Ephemeral embed: `My 10man` hub with current Steam assignment, queue status, active match state, and action buttons (Join Queue, Leave Queue, My Match Info, Report Result Issue, etc.).  |
| `/10man alerts enabled`            | Ephemeral confirmation text. Updates preference and, if enabled, verifies DM permissions without throwing if DMs are closed.                                                              |
| `/10man account`                   | Ephemeral embed showing assigned Steam ID (or none) with **Change** and **Remove** buttons; Change opens the existing Steam-identifier modal.                                             |
| `/10man history [player]`          | Ephemeral embed listing recent finished matches with map, result, scoreline, date, and dispute/rollback buttons visible only to staff.                                                    |
| `/10man stats [player]`            | Ephemeral embed with rating, W–L record, streak, and map record.                                                                                                                          |
| `/10man party`                     | Ephemeral party panel: Create / Invite user-select / Leave / Kick select / Disband depending on caller's party state. Invitation acceptance happens via DM/message button, not a command. |
| `/10man admin queue-panel`         | Reposts or repairs the persistent queue panel in the configured lobby channel; replies with an ephemeral confirmation.                                                                    |
| `/10man admin match`               | Ephemeral active-match admin panel with context-aware buttons: Force Ready, Restart Phase, Replace Player (user selects), Stop Match.                                                     |
| `/10man admin queue`               | Ephemeral queue moderation panel with user-select Ban/Unban controls and current ban list.                                                                                                |
| `/10man admin players`             | Ephemeral player admin panel with user-select Reset Stats and queue-ban shortcuts.                                                                                                        |
| `/10man admin disputes`            | Ephemeral list of pending Steam and result disputes; each row has signed Resolve/Reject buttons tied to the dispute ID.                                                                   |
| `/10man admin diagnostics`         | Ephemeral formatted diagnostic report.                                                                                                                                                    |
| `/10man config setup`              | Ephemeral confirmation showing created category, channels, and roles; uses existing signed confirmation controls.                                                                         |
| `/10man config configure`          | Ephemeral confirmation after saving settings. If validation fails, returns a clear error and the current values.                                                                          |
| `/10man config status`             | Ephemeral configuration summary (enabled state, template, profile, queue size, timeouts, managed resources).                                                                              |
| `/10man config enable` / `disable` | Ephemeral confirmation of state change.                                                                                                                                                   |
| `/10man config teardown`           | Ephemeral confirmation panel listing resources to archive, with signed Confirm button.                                                                                                    |
| `/10man config recover-setup`      | Ephemeral recovery preview with signed Acknowledge button.                                                                                                                                |

---

## 6. Permission matrix

| Command / surface              | Player | Privileged | Moderator | Administrator | Native Discord Administrator |
| ------------------------------ | :----: | :--------: | :-------: | :-----------: | :--------------------------: |
| `/10man`                       |   ✅   |     ✅     |    ✅     |      ✅       |              ✅              |
| `/10man alerts`                |   ✅   |     ✅     |    ✅     |      ✅       |              ✅              |
| `/10man account`               |   ✅   |     ✅     |    ✅     |      ✅       |              ✅              |
| `/10man history`               |   ✅   |     ✅     |    ✅     |      ✅       |              ✅              |
| `/10man stats`                 |   ✅   |     ✅     |    ✅     |      ✅       |              ✅              |
| `/10man party`                 |  ✅\*  |    ✅\*    |   ✅\*    |     ✅\*      |             ✅\*             |
| `/10man admin queue-panel`     |   ❌   |     ✅     |    ✅     |      ✅       |              ✅              |
| `/10man admin match`           |   ❌   |     ❌     |    ✅     |      ✅       |              ✅              |
| `/10man admin queue`           |   ❌   |     ❌     |    ✅     |      ✅       |              ✅              |
| `/10man admin players`         |   ❌   |     ❌     |    ✅     |      ✅       |              ✅              |
| `/10man admin disputes`        |   ❌   |     ❌     |    ✅     |      ✅       |              ✅              |
| `/10man admin diagnostics`     |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |
| `/10man config setup`          |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |
| `/10man config configure`      |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |
| `/10man config status`         |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |
| `/10man config enable/disable` |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |
| `/10man config teardown`       |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |
| `/10man config recover-setup`  |   ❌   |     ❌     |    ❌     |      ✅       |              ✅              |

\* Party commands require `partyEnabled` guild setting.

---

## 7. Channel-scope matrix

| Command / surface                                     | Scope                             | Justification                                                                   |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `/10man`                                              | Any guild channel                 | Personal, ephemeral, no spam risk                                               |
| `/10man alerts`                                       | Any guild channel                 | Personal preference                                                             |
| `/10man account`                                      | Any guild channel                 | Personal account management                                                     |
| `/10man history`                                      | Any guild channel                 | Personal stats lookup                                                           |
| `/10man stats`                                        | Any guild channel                 | Personal stats lookup                                                           |
| `/10man party`                                        | Any guild channel                 | Personal/small group management                                                 |
| `/10man admin queue-panel`                            | Any guild channel or managed only | Staff-only; low risk, but may be restricted to managed channels for consistency |
| `/10man admin match`                                  | Any guild channel                 | Staff need to act from wherever they are                                        |
| `/10man admin queue`                                  | Any guild channel                 | Staff moderation                                                                |
| `/10man admin players`                                | Any guild channel                 | Staff player administration                                                     |
| `/10man admin disputes`                               | Any guild channel                 | Staff dispute resolution                                                        |
| `/10man admin diagnostics`                            | Any guild channel                 | Staff diagnostics                                                               |
| `/10man config setup`                                 | **No restriction**                | Bootstrap: managed channels do not exist yet                                    |
| `/10man config configure`                             | Any guild channel                 | Admin-only; can run anywhere                                                    |
| `/10man config status`                                | Any guild channel                 | Admin-only                                                                      |
| `/10man config enable/disable/teardown/recover-setup` | Any guild channel                 | Admin-only                                                                      |

**Rationale for relaxing personal commands:** These commands are ephemeral, stateless for the channel, and do not expose match credentials. Forcing players into a specific channel to check their own status or manage their Steam account adds friction without improving security.

---

## 8. Migration / deprecation strategy

1. **Remove old top-level commands entirely**
   - `/steam`, `/match`, `/player`, `/party` will be removed from the registered command set.
   - `/10man hub`, `/10man status`, `/10man cancel` will be removed.

2. **No long-term aliases**
   - Discord's command picker will show only the new tree after registration propagates.
   - Do not maintain duplicate command handlers.

3. **Optional transitional release**
   - If a transitional rollout is desired, the old commands may remain registered for one release and reply with an ephemeral message such as:
     > "This command has moved. Use `/10man history` to view matches or `/10man admin match` for moderation."
   - A specific removal point (e.g., the following release) must be documented.

4. **Guild command registration**
   - `registerCommands` will register the new `/10man` tree only.
   - Because commands are global, the old names will disappear after Discord's propagation delay (up to ~1 hour).

5. **Internal component namespaces**
   - Existing signed custom-ID namespaces (`tms:`, `tmp:`, `tma:`, `tmd:`, etc.) remain unchanged.
   - New admin panels may introduce a namespace such as `tma2:` panel refresh if needed, but should reuse existing builders where possible.

---

## 9. Testing plan

### 9.1 Command-builder tests

- Verify every surviving command has a valid name and description length.
- Verify required options appear before optional options in every subcommand.
- Verify no raw identifier options (`party_id`, `invite_id`, `match_id`, `dispute_id`) remain in player-facing commands.
- Verify `/10man config setup` has no channel restrictions at the builder level (channel-scope enforced in handler).

### 9.2 Registration tests

- Snapshot or enumerate the final set of registered 10man commands.
- Assert `/steam`, `/match`, `/player`, and `/party` are not registered.

### 9.3 Routing tests

- Each surviving command maps to the correct handler/service.
- Removed commands return an appropriate "unknown command" response or are not present.

### 9.4 Permission tests

- Each command rejects users without the required role/permission.
- Native Discord `Administrator` permission bypasses role checks.

### 9.5 Channel-scope tests

- Personal commands succeed in a non-managed guild text channel.
- Admin/config commands succeed in any guild channel for authorized users.
- `/10man config setup` succeeds before managed channels exist.

### 9.6 GUI entry-point tests

- `/10man`, `/10man account`, `/10man history`, `/10man stats`, `/10man party`, and every `/10man admin`/`/10man config` command returns an ephemeral embed or panel with components.
- No surviving player command returns a plain text dump as its primary output.

### 9.7 Component safety tests

- All buttons generated by new admin panels use signed custom IDs.
- Version/phase-generation checks remain in place for match controls.
- Audit events are still emitted for destructive actions.

### 9.8 Stale-context tests

- Running `/10man admin match` when no match is active returns an empty state with a link to the hub or queue panel.
- Running `/10man party` when parties are disabled returns a clear message.

### 9.9 Mobile-friendly output

- Embed titles and field names are short enough for Discord mobile.
- Button labels are concise.

---

## 10. Implementation notes

- Do **not** weaken existing safety controls: signed custom IDs, actor binding, version/generation checks, transaction-level authorization, durable audit events, and secret redaction must remain.
- New admin panels should reuse existing component builders (`buildAdminConfirmationControls`, `buildPlayerStatsResetConfirmationControls`, etc.) where applicable.
- The `player-status-service`, `match-history-service`, `steam-account-service`, and dispute services already provide the data needed for the new panels; this work is primarily command and presentation cleanup.
- If parties are not enabled in a guild, `/10man party` should inform the user rather than create a party.
