# ADR: Durable forming phases

Ready check, captain selection, draft, and veto are persisted phases with
deadlines and leased timeout jobs. No in-memory timer decides a match outcome.
All phase mutations use transactional concurrency checks and write a state
transition/audit record.
