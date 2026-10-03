# Game server card polish

The persistent card uses a native Components V2 Container with a Section/Thumbnail
header, six consistently spaced Separators, the approved description, one Media
Gallery, three standalone metadata rows, and the existing three-button Action Row.
The header renders the name followed directly by the status and optional location
on one natural-wrapping metadata line; provider city labels such as `dallas` display
as `Dallas`. The lower rows are address, map, and player count, in that order, with
no redundant labels or padding assumptions.

The component tree is: Section (title plus status/location, thumbnail), Separator,
description Text Display, Separator, Media Gallery, Separator, address Text Display,
Separator, map Text Display, Separator, player-count Text Display, Separator, then
the Connect, Map & Rules, and Copy Address Action Row. The status line omits both
the dot and location when no location is available. A missing address remains
`🔗 Unavailable`; an unknown map remains `🗺️ Unknown`; player counts retain a
configured maximum such as `👥 3 / 5 Players`.

The card's Media Gallery uses the dedicated neutral server banner at
`assets/server-info/clickcs-server-banner.png`; its thumbnail uses the companion
`clickcs-server-thumbnail.png`. These fixed server-info assets keep the layout
stable while Discord determines the rendered media dimensions. Map artwork
resolution remains available through the existing helper and does not determine
the persistent card banner.

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

Connect keeps its existing signed Primary interaction when no join URL is set.
Servers with a join URL retain their direct Link button. Map & Rules and Copy
Address remain Secondary. No custom IDs or interaction handlers changed.

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

`layoutVersion` 6 in the saved card fingerprint causes an existing message to be
edited on its next refresh after deployment, including when server state is
unchanged. Subsequent unchanged refreshes continue to skip Discord edits.

## Validation

Automated coverage checks the thirteen-child component order, native Discord
serialization, known/unknown/workshop maps, artwork precedence, location
de-duplication, zero and full occupancy, long values, offline/starting/stale states,
all three existing controls, and updating the existing message after a layout
change. No schema migration is required for the layout change.

Real-client acceptance remains necessary after deployment: inspect desktop,
narrow desktop and mobile Discord for readable wrapping and height, plus online,
offline, zero/full occupancy, known/unknown maps and long metadata. Payload tests
and inspecting the source banner do not establish Discord client appearance.

API reference: <https://docs.discord.com/developers/components/reference>
