# 10man deployment

## Deployment order

1. Create an empty PostgreSQL database and set `DATABASE_URL`.
2. Apply the initial schema with the deployment command for the target environment.
3. Generate the Prisma client, build the application, register commands, and
   start the bot and worker with the same component-signing secret.
4. Configure managed Discord resources and a DatHost template through the
   administrator commands.
5. Complete the staging checklist: queue promotion, deadlines, resource
   reconciliation, MatchZy result deduplication, and cleanup.

## Database baseline

The repository contains a sequential migration history beginning with
`20260920000000_initial_schema` and continuing through the Steam-assignment,
dispute, and queue-alert changes. Apply it to a new PostgreSQL database or an
existing deployment with `prisma migrate deploy`; retain a backup before any
destructive database operation.

## Recovery

`MATCH_PHASE_TIMEOUT` and `MATCH_RESOURCE_RECONCILE` are durable jobs.
`CREATE_IN_FLIGHT` means Discord may have accepted a create request before its
ID was saved: inspect the channel and audit log manually rather than retrying
by name or deleting an unproven resource.
