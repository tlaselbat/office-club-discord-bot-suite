# ADR: First-release 10man schema

## Decision

The durable queue, ready check, captain draft, map veto, owned match resources,
ratings, and recovery workflow are the supported 10man model. The schema is a
single initial baseline with no compatibility flags or alternate lifecycles.

## Consequences

- Every cancellation enters durable cleanup because match Discord resources may
  exist before a game server is provisioned.
- Queue and dashboard components are the only accepted 10man interaction
  protocols.
- Deployments must apply all migrations before starting bot or worker processes.
