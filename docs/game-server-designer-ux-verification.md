# Game Servers Card Designer implementation and verification

This report records the initial local implementation verification on October 8, 2026. Live release verification is reported separately.

## UX changes

The former stack of expanded element forms is now an ordered list with one contextual properties panel. Selection moves the existing controls rather than cloning them, so there is one authoritative set of draft values. Wide screens show elements, properties, and Discord Preview together. Smaller screens adapt to fewer columns; mobile selection scrolls to the properties editor.

Rows show type icons, friendly names, content summaries, visibility, selection, keyboard-operable Up/Down buttons, and an actions menu. Add Element is a compact disclosure. Duplicate preserves all configured properties and gallery items while generating new IDs. Removal has Undo and preserves the restored element/item IDs. The last element and last gallery item cannot be removed. The existing 35-element and 10-image limits are enforced in the editor.

Text and section editors preserve multiline templates, supported text styles, Markdown formatting, all placeholders, and restore actions. Gallery item controls are nested and support individual sources, descriptions, ordering, and deletion. Thumbnail sections can be converted to text blocks without changing their element ID. Button settings remain in one shared subsection.

Appearance, Status Presentation, Action Buttons, and Advanced settings are grouped in disclosures. Restore Defaults is separate from the single save/discard bar. Saved configuration details, including the actual saved layout, are expandable. Live Data has scannable hosting, gameplay, player, map, location, polling, and last-success summaries, with complete technical details retained.

## Preview and correctness fixes

Preview reads the same versioned layout envelope submitted to the save route. It reflects element order, visibility, text styles, sections/thumbnails, galleries, native divider/spacing modes, the action row in its configured position, and Latest Updates. It uses safe DOM text/Markdown rendering and HTTPS image URLs, preserves image aspect ratios, and shows unavailable-media placeholders. Failed media is cached during the page session to avoid repeated failed requests while typing.

Artwork selection reuses `resolveMapImageUrl` for canonical lookup. Unsaved configured fallback changes are reflected immediately. The source indicator distinguishes cached/example telemetry and canonical/configured/bundled artwork. The fixture map `am_anubis_p` has no canonical asset in this checkout, so its automatic source is the existing bundled fallback banner. No map asset was changed or inferred from a screenshot.

Preview can expand and collapse. It is sticky only when it fits the available viewport; tall cards remain in normal page flow. Save controls use normal flow on tablet/mobile to prevent covering the editor.

Two existing correctness defects were fixed: the browser submitted a bare element array even though the route expects `{ version: 1, elements }`, and thumbnail sections ignored their configured text style in the Discord renderer. Legacy array drafts are accepted for hydration and submitted in the canonical envelope. The schema, existing saved IDs, authentication, authorization, CSRF, and optimistic version checks remain intact.

Dirty state compares the complete form with its initial saved draft. Selection and preview modes do not mark configuration dirty. Discard rebuilds the original layout, including structural edits. Malformed drafts remain intact and cannot accidentally be saved over with an empty layout. Invalid fields in hidden elements or collapsed settings are revealed and focused. Successful saves return to Card Designer with a persistence notice; Discord deployment state remains separately visible. Deployment removal asks for confirmation.

## Browser verification

Playwright exercised the real rendered page templates, styles, and JavaScript using an isolated HTTP fixture at `127.0.0.1:4318`. The fixture writes only in-memory configuration and validates it with the existing profile schema and Discord renderer.

| Viewport width | Horizontal overflow | Contextual properties                    | Preview behavior                              |
| -------------- | ------------------- | ---------------------------------------- | --------------------------------------------- |
| 1920           | None                | One selected editor                      | Alongside editor; tall preview in normal flow |
| 1440           | None                | One selected editor                      | Alongside editor                              |
| 1280           | None                | Properties below compact list            | Alongside editor                              |
| 1024           | None                | Elements and properties together         | Preview below editor                          |
| 768            | None                | Elements and properties together         | Preview below; normal-flow save bar           |
| 390            | None                | Stacked; selection scrolls to properties | Stacked/collapsible; normal-flow save bar     |

Verified workflows: element selection; draft retention during selection; multiline text; Markdown and placeholder insertion; gallery creation; independent gallery fields; custom/fallback source changes; gallery ordering; separator creation and spacing; element ordering; duplication with every gallery item; removal/Undo with stable IDs; hide/show; immediate preview; cached/online/offline/unavailable modes; fixture save/reload and renderer acceptance; persistence on a second reload; active selection after reload; discard after structural changes; keyboard selection/reordering; expanded/collapsed preview; failed-media fallback; 500-character formatting protection; 35-element limit; malformed draft preservation; hidden-field validation/focus; and unsaved-navigation warning. No JavaScript page errors were present in the final responsive pass.

Actual cached artwork matched the shared resolver. Canonical-source priority was separately exercised with a simulated known-asset dataset; real canonical asset resolution is covered by renderer unit tests. Authentication-dependent live admin pages, real database persistence, and Discord API reconciliation were not exercised in the browser.

Local screenshot artifacts are under `.template-staging/game-server-ux/`: `before-1440.png`, `after-1920.png`, `after-1440.png`, `after-1280.png`, `after-1024.png`, `after-768.png`, `after-390.png`, and `after-390-properties.png`. The temporary fixture server source is retained there as `server.ts`; run it with `pnpm exec tsx .template-staging/game-server-ux/server.ts` for local inspection.

## Regression verification

- `pnpm typecheck` and `pnpm build` passed.
- Focused ESLint and Prettier checks passed for changed source/test files.
- `git diff --check` passed.
- Targeted HTTP/admin-security/layout and Game Servers unit suites: **189 passed**.
- Database-dependent card-profile integration suite: **2 tests skipped** because a test database was not configured.
- Added regressions cover the browser's layout envelope, stable IDs through route persistence, safely embedded cached update messages, save redirection/status, new page structure, and styled Discord thumbnail sections.

The preview remains an approximation: Discord controls final rendering, custom emoji appearance, timestamps, component limits, and total text-budget truncation. Live database and Discord reconciliation validation remains a release-time check. No live server was modified.

## Modified files

- `src/http/admin/views/pages/game-servers.ts`: page workspace, grouped settings, telemetry, saved inspection, preview metadata.
- `src/http/admin/views/card-lines.ts`: contextual editor, draft lifecycle, element/gallery actions, formatting, validation.
- `src/http/admin/views/card-preview.ts`: safe normalized-layout browser preview (new).
- `src/http/admin/views/styles.ts`: responsive workspace and reusable controls.
- `src/http/admin/views/client.ts`: deployment-removal confirmation.
- `src/http/admin/views/components.ts`: asset cache version.
- `src/http/routes/admin/game-servers.ts`: cached Updates read and post-save navigation/status.
- `src/modules/game-servers/renderer.ts`: respect section text styles.
- `tests/unit/http/admin-pages.test.ts`.
- `tests/unit/http/game-server-routes.test.ts`.
- `tests/unit/modules/game-servers/renderer.test.ts`.
- `docs/game-server-designer-ux-verification.md`: this report.

One bounded worker and one read-only reviewer were used. Both reached a usage limit; the primary agent completed the final editor integration, review, and verification.
