# Office Club Competitive release guarantees

| Guarantee                                     | Evidence                                           |
| --------------------------------------------- | -------------------------------------------------- |
| One forming/live/cleanup-held match per guild | Database slot constraint and queue-promotion tests |
| Queue identity and promotion integrity        | Queue service concurrency and uniqueness tests     |
| Forming-phase deadlines                       | Phase-timeout and startup-recovery tests           |
| Signed, stale-safe interactions               | Queue, dashboard, and admin custom-ID tests        |
| Owned-resource-only cleanup                   | Match-resource and cleanup orchestrator tests      |
| Idempotent result processing and rollback     | MatchZy event, reconciliation, and history tests   |
| Rewards isolation                             | Full Rewards unit, contract, and integration suite |
