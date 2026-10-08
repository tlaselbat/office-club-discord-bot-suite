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

All six editors use generic stable names, Card Line 1 through Card Line 6. Their
internal IDs remain unchanged when Up/Down controls reorder them. Every line
supports all placeholders, show/hide, reset, bold, italic, underline,
strikethrough, inline code, and large/medium/small/normal/subtext styles. Heading
styles affect the first text row; embedded Markdown is preserved. Empty lines
are omitted. Each template accepts up to 500 characters.

The ordered `textLines` array is optional. Records without it keep the exact
legacy renderer and configured templates, visibility, body order, description
fallback, artwork, buttons, and deployments. The editor materializes those saved
values without writing them. Saving explicitly adopts generic lines. Submissions
from an old editor cannot erase a saved generic profile; they must reload first.
No database migration is required.

The preview shares placeholder substitution and heading rules with the renderer.
It loads cached values, including pending state when no snapshot exists, and has
online, offline, and unavailable examples. It updates order, visibility, labels,
formatting, and heading styles before saving. Markdown is rendered through safe
DOM text nodes; no user HTML or URL is executed. Browser spacing, custom emojis,
and Discord-specific Markdown remain approximate.

Components V2 keeps the first three ordered positions in the thumbnail section.
The artwork separator is before position five and the gallery after it;
text visibility never controls artwork. Map artwork has its own checkbox.
Buttons, the final separator, and updates remain below the six text positions.
All six lines can move across the header/body boundary. These fixed non-text
anchors are disclosed in the editor. Local map artwork priority and fallback,
thumbnail inheritance, buttons, and signed interactions remain operational.

Discord allows 40 total components and 4,000 text characters across Text Display
components. The fixed layout stays below the component cap. Oversized expanded
text (including update entries) is proportionally shortened with an ellipsis;
shortening can cut Markdown syntax. Normal-size cards render unchanged.

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
