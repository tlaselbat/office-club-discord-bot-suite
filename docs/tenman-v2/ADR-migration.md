# ADR: First-release 10man schema

## Decision

This bot has no deployed predecessor. The durable queue, ready check, captain
draft, map veto, owned match resources, ratings, and recovery workflow are the
only supported 10man model. The schema does not retain a workflow flag,
legacy-panel fields, registration gate, or queue-less lifecycle states.

## Migration safety

The final schema migration refuses to run if a database contains a non-current
match row. This prevents silently misrepresenting unknown historical data as a
first-release match. A fresh deployment is the supported installation path.

## Consequences

- Every cancellation enters durable cleanup because match Discord resources may
  exist before a game server is provisioned.
- Queue and dashboard components are the only accepted 10man interaction
  protocols.
- Deployments must apply all migrations before starting bot or worker processes.
