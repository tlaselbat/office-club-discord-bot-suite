# ADR: Queue and match are separate durable records

The guild queue is persistent and does not occupy the active-match slot. A
full queue is promoted atomically to one `READY_CHECK` match, which does occupy
that slot. This avoids treating a lobby message or partially filled roster as a
game lifecycle.

Queue entries are unique by guild/user and guild/Steam identity. Queue version,
match version, and phase generation invalidate stale signed controls.
