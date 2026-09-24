# Office Club Competitive state machine

```text
CREATED → READY_CHECK → TEAM_SELECTION → MAP_VETO → TEAMS_LOCKED
        → SERVER_PROVISIONING → SERVER_BOOTING → SERVER_READY
        → MATCH_LOADED → WARMUP → LIVE ↔ PAUSED → FINISHED
```

`CANCELED` and `FAILED` are terminal from every non-terminal state. Durable
cleanup can retain the guild slot after terminal state until owned Discord and
server resources are settled.

Ready, captain selection, drafting, and veto each have persisted deadlines and
durable timeout jobs. Every phase mutation increments the match version and
generation; signed components carry both values and handlers reread the match
before updating it.
