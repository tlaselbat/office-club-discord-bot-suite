# 10man first-release deployment

## Deployment order

1. Create an empty PostgreSQL database and set `DATABASE_URL`.
2. Apply the complete migration set with the deployment command for the target
   environment.
3. Generate the Prisma client, build the application, register commands, and
   start the bot and worker with the same component-signing secret.
4. Configure managed Discord resources and a DatHost template through the
   administrator commands.
5. Complete the staging checklist: queue promotion, deadlines, resource
   reconciliation, MatchZy result deduplication, and cleanup.

## Existing data

This release intentionally has no conversion path for an earlier 10man
workflow. The final migration stops when it sees legacy match records. Export
or archive such a database; do not point this release at it.

## Recovery

`MATCH_PHASE_TIMEOUT` and `MATCH_RESOURCE_RECONCILE` are durable jobs.
`CREATE_IN_FLIGHT` means Discord may have accepted a create request before its
ID was saved: inspect the channel and audit log manually rather than retrying
by name or deleting an unproven resource.
