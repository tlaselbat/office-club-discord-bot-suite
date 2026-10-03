# Game server card polish

The persistent card uses a native Components V2 Container with a Section/Thumbnail
header, a small Separator, one three-line metadata Text Display, one Media Gallery,
and the existing two-button Action Row. The header combines the name and status
line; location appears once and provider city labels such as `dallas` display as
`Dallas`. Metadata uses separate concise lines so long hosts and addresses do not
depend on padded columns.

The checked-in `assets/game-servers/maps/fallback/clickcs-arena.jpg` is already
1024 × 341 (approximately 3:1). It preserves the center lane, concrete and orange
architecture without text or controls. Reuse this existing crop. Resolution order
remains canonical map artwork, configured server image URL, then this banner.
Configured remote images keep their original aspect ratio; Discord does not offer
an arbitrary crop/height property for Media Gallery items. New map and server
artwork should be supplied at approximately 2.5:1–3:1.

### Discord media cache correction

The first deployment still displayed the old 1024 × 576 image: a read of the actual
Discord message reported those cached dimensions even though both the local file
and GitHub origin were 1024 × 341. Replacing the file at the same URL was insufficient.
The renderer now uses `clickcs-arena-banner-779a25c6.jpg`, an identical copy of the
compact artwork whose filename includes its SHA-256 prefix. Future artwork changes
must get new content-versioned filenames. The changed URL also changes the card
fingerprint, causing the existing message to refresh without recreating it.
Tests verify that the filename matches the bytes and that an old artwork URL
triggers a persistent message edit. After deployment, verify the dimensions on
Discord's returned media object, not just the origin asset or component types.

Connect keeps its existing signed Success interaction when no join URL is set.
Servers with a join URL retain their direct Link button. Discord does not permit
Success styling on URL buttons; preserving the existing one-click connection
behavior takes precedence over that mockup detail. Map & Rules remains Secondary.
No custom IDs or interaction handlers changed.

## Current-map investigation

A read-only production probe on 2026-10-03 confirmed that ClickCS uses the generic
fallback banner. Its DatHost server response exposed `cs2_settings.maps_source`,
`mapgroup`, `mapgroup_start_map` and workshop start-ID settings, but no current-map
field. The CS monitoring response contained no map field. In particular,
`mapgroup_start_map: de_dust2` is configuration, not evidence of the live map.
The existing provider mapping is preserved; no new authoritative map mapping was
verified. A missing map therefore remains `Unknown`. Fixing that for this server
requires an authoritative live source beyond the currently consumed responses.
Historical maps-played totals or passive console backlog must not be substituted
for live state. Workshop paths, `.bsp` extensions and empty map values are now
normalized consistently for display and artwork lookup when map data is available.

DatHost references: [server object](https://dathost.readme.io/reference/get_game_server_item)
and [monitoring metrics](https://dathost.readme.io/reference/get_cs_monitoring_server_metrics).

`layoutVersion` in the saved card fingerprint causes an existing message to be
edited on its next refresh after deployment, including when server state is
unchanged. Subsequent unchanged refreshes continue to skip Discord edits.

## Validation

Automated coverage checks the component order, native Discord serialization,
known/unknown/workshop maps, artwork precedence, location de-duplication, zero and
full occupancy, long values, offline/starting/stale states, exactly two controls,
existing Connect and Map & Rules handlers, and updating the existing message after
a layout change. No schema migration is required for the layout change.

Real-client acceptance remains necessary after deployment: inspect desktop,
narrow desktop and mobile Discord for readable wrapping and height, plus online,
offline, zero/full occupancy, known/unknown maps and long metadata. Payload tests
and inspecting the source banner do not establish Discord client appearance.

API reference: <https://docs.discord.com/developers/components/reference>
