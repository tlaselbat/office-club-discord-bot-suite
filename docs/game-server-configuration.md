# Game Server configuration

The database is authoritative. The webpanel loads saved registration values and
the nullable `GameServer.cardProfile` JSON column. The webpanel's saved profile
summary and Discord renderer resolve presentation defaults through
`src/modules/game-servers/card-profile.ts`.

## Editable values

| Setting                                     | Persistence                | Behavior                                                                                              |
| ------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Display name and description                | Existing server columns    | Card heading/body; a blank description retains the legacy default text                                |
| Accent color                                | Card Profile               | Six-digit hex color; legacy default `#2b8aef`                                                         |
| Thumbnail URL                               | Card Profile               | Valid HTTPS URL; blank inherits the legacy server icon                                                |
| Map artwork fallback URL                    | Existing `imageUrl` column | Canonical local map artwork takes priority; blank uses the legacy banner                              |
| Online, offline, warning, pending emoji IDs | Card Profile               | Discord snowflakes; blank inherits the corresponding deployment environment setting, then a plain dot |
| Connect domain and HTTPS join URL           | Existing server columns    | Address override and server-detail link; card Connect interaction remains signed                      |
| Polling, public visibility, sort order      | Existing server columns    | Monitoring, publication eligibility, and listing order                                                |

Telemetry (status, players, map, location, metrics, observation times) remains
read-only. Update-thread contents remain managed by the existing thread workflow.
Component structure, button semantics and labels retain the existing card design.
Publishing, moving, refreshing/repairing and removing individual displays remain
independent of server registration.

Disabling the module stops subsequent polling, card publication/reconciliation,
and managed update-thread reconciliation. Existing displays and configuration
remain saved; privacy cleanup and removals remain available. Guilds without a
settings row retain the legacy enabled default, accurately shown by the webpanel.
The first settings mutation or server registration initializes the saved row.

Invalid form values show field errors and retain unsaved edits. The saved summary
remains separate. A stale-version conflict retains the submitted version so a
second submit cannot silently overwrite the newer configuration; reload first.

## Synchronization and recovery

Saved presentation changes enqueue revision-specific card refresh jobs in the
same transaction as the configuration update. Fingerprints cover effective color,
thumbnail, status emoji, content, artwork, address and update-thread state. Legacy
rows with no profile resolve compatible defaults. A stale observation is labeled
stale even when its last hosting state was stopped or starting.

Lifecycle operations serialize publication/reconciliation for each registered
server. A failed destination publish preserves its source. Transient Discord
fetch errors preserve the managed deployment row and expose an error; only a
confirmed missing message or channel permits removal without deleting the message. Private
server cleanup uses durable refresh jobs to retry failed removals.

## Before release

Apply the additive `20261007000000_game_server_card_profile` migration before
starting the updated application. Review the scoped diff because this checkout
also contains earlier, uncommitted webpanel changes.

Automated fixtures and mocks verify contracts and failure paths. Live acceptance
still requires an isolated Discord server: verify migration/restart persistence,
existing-message identity after profile saves, permissions and guild ownership,
concurrent publication, move failure recovery, private cleanup, actual custom
emoji availability, remote image rendering, and DatHost outage recovery.
Syntactically valid media URLs can still be unavailable or rejected by Discord.
No production deployment is part of this change.
