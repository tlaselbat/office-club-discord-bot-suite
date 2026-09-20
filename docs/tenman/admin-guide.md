# 10man administration guide

## Configure the guild

Run `/match admin configure` after its normal channel, role, and template
checks pass. Configure a queue size equal to twice the selected profile's
`playersPerTeam` (10 for `competitive_5v5`) and a ready timeout between 15 and
900 seconds. `/10man queue` creates or repairs the persistent queue panel.

The implemented formation workflow supports 5v5 profiles, random captains,
captain drafting or random teams, and captain veto or random maps. Unsupported
policy values are rejected before a queue can form an invalid match.

## Operations

Cancellation, phase restart, result rollback, player-stat reset, queue clearing,
and resource teardown require an actor-bound, expiring signed confirmation.
Use `/10man status` and `/match admin diagnostics` before and after a worker
restart. Queue bans are durable and audited; use `/match admin queue-ban` and
`/match admin queue-unban`.

The bot deletes a match channel or dashboard only when a durable ownership row
proves it created that resource. Treat `CREATE_IN_FLIGHT` as an operator-review
state, not a prompt to retry or delete by name.
