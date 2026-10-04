# Game server card polish

The persistent card uses a native Components V2 Container with a Section/Thumbnail
header, one Separator, one Media Gallery, and a two-button Action Row. The header renders
the name, then a level-three status/location heading and a separate lower-case player-count
subtext line. Configured custom status-dot emojis fall back to a plain text dot.
The standalone description uses a configured nonempty description when present;
otherwise it renders the approved two-line default. The lower rows are the labeled current
map, map artwork, then the copyable address, with no padding assumptions.

The component tree is: Section (title and status summary, thumbnail), description Text
Display, Separator, current-map Text Display, Media Gallery, address Text Display,
then Connect and Map & Rules. The container accent stays blue for every state. The status
remains honest for offline, starting, stale, and unavailable states. A missing address
renders as `` `Unavailable` ``; an unknown map remains `` `Unknown` ``; player counts
retain a configured maximum such as `3 / 5 players`.

Use the existing `/servers admin edit` `description` option to override the entire
description block for another server, including an optional second line beginning
with `-# ` for native subtext. Blank descriptions use the two-line default. This
reuses the existing description/rules setting; Map & Rules continues to read that
same setting. Description changes are included in the saved card fingerprint, and
card payloads suppress mentions during refreshes.

The Media Gallery uses the resolved map artwork selected by the existing helper: a local
canonical map asset first, then the configured server image, then the versioned fallback.
The header thumbnail remains `assets/server-info/clickcs-server-thumbnail.png`.

### Historical Discord media cache correction

The first deployment still displayed the old 1024 × 576 image: a read of the actual
Discord message reported those cached dimensions even though both the local file
and GitHub origin were 1024 × 341. Replacing the file at the same URL was insufficient.
The earlier map-banner renderer used `clickcs-arena-banner-779a25c6.jpg`, a copy of the
compact artwork whose filename includes its SHA-256 prefix. Future artwork changes
must get new content-versioned filenames. The changed URL also changes the card
fingerprint, causing the existing message to refresh without recreating it.
Tests verify that the filename matches the bytes and that an old artwork URL
triggers a persistent message edit. After deployment, verify the dimensions on
Discord's returned media object, not just the origin asset or component types.

Connect always keeps its existing signed Primary interaction, including for servers with
a join URL. Map & Rules remains Secondary. Copy Address is no longer rendered, although
its backward-compatible handler remains available. Custom IDs are unchanged. Connect
returns ephemeral instructions with the actual `connect hostname:port` command and
any configured join URL. It remains accessible when the address is known even if the
server is offline or telemetry is stale; it does not launch the game or use the clipboard.

## Current-map investigation

A read-only production probe on 2026-10-03 confirmed that ClickCS uses the generic
fallback banner. Its DatHost server response exposed `cs2_settings.maps_source`,
`mapgroup`, `mapgroup_start_map` and workshop start-ID settings, but no current-map
field. The CS monitoring response contained no map field. In particular,
`mapgroup_start_map: de_dust2` is configuration, not evidence of the live map.
A subsequent live probe confirmed that the game server's A2S_INFO response reports
the current map (`am_water_wf` during verification), while DatHost's server response
does not expose `cs2_settings.map`. Running-server polls now read that live map via
a connected UDP socket to the provider's numeric IPv4 address and game port. The
query has a two-second total timeout and permits one challenge retry. It rejects
malformed or split responses and closes its socket on completion or failure.

Failed queries, unsupported endpoints, and non-running servers leave the map
`Unknown`. Configured start maps, historical maps-played totals, and passive console
backlog are not current-map evidence. Map-query failures do not prevent existing
status/player monitoring. The normal snapshot and persistent-card update cycle
publishes successful map observations; no migration or layout-version bump is needed.
Workshop paths and `.bsp` extensions remain normalized for display.

DatHost references: [server object](https://dathost.readme.io/reference/get_game_server_item)
and [monitoring metrics](https://dathost.readme.io/reference/get_cs_monitoring_server_metrics).

`layoutVersion` 15 in the saved card fingerprint causes an existing message to be
edited on its next refresh after deployment, including when server state is
unchanged. Subsequent unchanged refreshes continue to skip Discord edits.

## Validation

Automated coverage checks the seven-child component order, native Discord serialization,
known/unknown/workshop maps, artwork precedence, configured descriptions, dynamic player
counts, unavailable addresses, offline/starting/stale states, both rendered controls, and
updating the existing message after a layout change. No schema migration is required.

Real-client acceptance remains necessary after deployment: inspect desktop,
narrow desktop and mobile Discord for readable wrapping and height, plus online,
offline, zero/full occupancy, known/unknown maps and long metadata. Payload tests
and inspecting the source banner do not establish Discord client appearance.

API reference: <https://docs.discord.com/developers/components/reference>

Discord's native [Markdown subtext](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline)
uses `-# ` at the start of a line. The user-approved newer design keeps the status
as a level-three heading and the player count on a separate subtext line, indented
with an em space and an en space. This differs from the original compact body-text
summary concept. Inline code is selectable text rather than a custom input control.
There are no fixed widths or custom fonts; long server and map names rely on
Discord's natural wrapping. Existing map artwork or the
fallback is used instead of reproducing the generated concept image.
