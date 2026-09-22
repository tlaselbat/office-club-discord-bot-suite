# 10man administration guide

## Configure the guild

`/match admin setup` is the only 10man slash-command bootstrap exception and
requires administrative authorization. After setup, invoke all other 10man
commands only in an active bot-managed 10man channel; commands from unrelated
channels are rejected.

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

The bot never deletes Discord channels. It archives and locks proven bot-owned
match channels, leaving final removal to a Discord administrator. Treat
`CREATE_IN_FLIGHT` as an operator-review state, not a prompt to retry or
delete by name.
