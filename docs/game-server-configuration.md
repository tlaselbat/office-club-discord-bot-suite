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

## Card templates and placeholders

The edit page saves per-server card templates, visibility flags, field order,
and button labels in the existing `GameServer.cardProfile` JSON column. This is
an additive JSON extension and does not require a database migration. Older
profiles keep their description and presentation defaults until a template is
saved. Optimistic server versions protect profile updates, and the existing
card refresh queue edits each published Discord message in place.

Supported placeholders are `{playercount}`, `{players}`, `{maxplayers}`,
`{online}`, `{status}`, `{statusicon}`, `{location}`, `{serveraddress}`,
`{serverip}`, `{serverport}`, `{currentmap}`, `{servername}`, and
`{lastupdated}`. `{severaddress}` remains accepted as a compatibility alias.
Tickrate and uptime are not offered because the current DatHost snapshot does
not provide them. Unavailable values render as an empty string or a clear
fallback, and any unknown token is rejected before saving. Resolved values
cannot trigger Discord mentions.

The preview loads cached server values when present and supports online,
offline, and unavailable example states. When no cached snapshot exists, the
current-state preview is explicitly labeled as using examples. The preview is
a text approximation; Discord remains responsible for final Component V2
Markdown and media rendering.

Editable fields include title, status/location subtitle, description, player
count, current map, and address. Description, map, and address can be reordered
through the comma-separated field order. Title, status, and player count stay
together in the native header section. Existing map artwork, thumbnail, accent, and status emoji
controls remain available. The Latest Updates sections can be hidden. Each
existing action can be hidden and relabeled;
its signed interaction behavior is unchanged.

Telemetry (status, players, map, location, metrics, observation times) remains
read-only. Update-thread contents remain managed by the existing thread workflow.
Component structure and button semantics retain the existing card design; labels
are configurable from the profile.
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

This extension uses the existing JSON profile column and adds no migration.
Review the scoped diff before release and verify saved templates against the
live Discord message after deployment.

Automated fixtures and mocks verify contracts and failure paths. Live acceptance
still requires an isolated Discord server: verify restart persistence,
existing-message identity after profile saves, permissions and guild ownership,
concurrent publication, move failure recovery, private cleanup, actual custom
emoji availability, remote image rendering, and DatHost outage recovery.
Syntactically valid media URLs can still be unavailable or rejected by Discord.
No production deployment is part of this change.
