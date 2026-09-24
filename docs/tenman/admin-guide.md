# Office Club Competitive administration guide

## Configure the guild

`/match config setup` is the bootstrap command and requires administrative
authorization (configured administrator role or native Discord Administrator).
All Office Club Competitive commands may be invoked from any guild channel;
authorization is enforced server-side at execution time.

Run `/match config configure` after its normal channel, role, and template
checks pass. Configure a queue size equal to twice the selected profile's
`playersPerTeam` (10 for `competitive_5v5`) and a ready timeout between 15 and
900 seconds. `/match admin queue-panel` creates or repairs the persistent Match
Queue panel.

The implemented formation workflow supports 5v5 profiles, random captains,
captain drafting or random teams, and captain veto or random maps. Unsupported
policy values are rejected before a queue can form an invalid match.

## Operations

Staff entry points:

- `/match admin match` — active-match panel: force ready, restart phase,
  replace participant (two-step user picks), and stop match.
- `/match admin queue` — queue moderation: ban and unban via user pickers; bans
  collect reason/duration in a modal.
- `/match admin players` — stats reset via user picker.
- `/match admin disputes` — pending result and Steam-assignment disputes with
  resolve/reject controls.
- `/match admin diagnostics` — safe diagnostics.

Players use `/match center` for everything else, including leader match
cancellation. Cancellation, phase restart, result rollback, player-stat reset,
and resource teardown require an actor-bound, expiring signed confirmation.
Use `/match center` and `/match admin diagnostics` before and after a worker
restart. Queue bans are durable and audited.

The bot never deletes Discord channels. It archives and locks proven bot-owned
match channels, leaving final removal to a Discord administrator. Treat
`CREATE_IN_FLIGHT` as an operator-review state, not a prompt to retry or
delete by name.
