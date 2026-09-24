# 10man administration guide

## Configure the guild

`/10man-config setup` is the bootstrap command and requires administrative
authorization (configured administrator role or native Discord Administrator).
All 10man commands may be invoked from any guild channel; authorization is
enforced server-side at execution time.

Run `/10man-config configure` after its normal channel, role, and template
checks pass. Configure a queue size equal to twice the selected profile's
`playersPerTeam` (10 for `competitive_5v5`) and a ready timeout between 15 and
900 seconds. `/10man-admin queue-panel` creates or repairs the persistent queue
panel.

The implemented formation workflow supports 5v5 profiles, random captains,
captain drafting or random teams, and captain veto or random maps. Unsupported
policy values are rejected before a queue can form an invalid match.

## Operations

Staff entry points:

- `/10man-admin match` — active-match panel: force ready, restart phase,
  replace participant (two-step user picks), and stop match.
- `/10man-admin queue` — queue moderation: ban and unban via user pickers; bans
  collect reason/duration in a modal.
- `/10man-admin players` — stats reset via user picker.
- `/10man-admin disputes` — pending result and Steam-assignment disputes with
  resolve/reject controls.
- `/10man-admin diagnostics` — safe diagnostics.

Players use `/10man hub` for everything else, including leader match
cancellation. Cancellation, phase restart, result rollback, player-stat reset,
and resource teardown require an actor-bound, expiring signed confirmation.
Use `/10man hub` and `/10man-admin diagnostics` before and after a worker
restart. Queue bans are durable and audited.

The bot never deletes Discord channels. It archives and locks proven bot-owned
match channels, leaving final removal to a Discord administrator. Treat
`CREATE_IN_FLIGHT` as an operator-review state, not a prompt to retry or
delete by name.
