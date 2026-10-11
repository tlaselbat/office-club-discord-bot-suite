# Game Server Card Studio: Phase 3 proposal

This proposal records follow-on architecture work after the preview-centered editor improvements. It does not authorize or implement a schema or renderer change.

## Candidate scope

1. Make individual Announcements and Changelog blocks first-class layout elements instead of children of the Community Updates element.
2. Add optional generic groups/containers if real card compositions need reusable visual grouping.
3. Add arbitrary feed-data placeholders only if users need update fields outside the dedicated Updates blocks.
4. Evaluate independently positioned Discord buttons only if the shared action row and Section accessories cannot support a demonstrated use case.

## Required design before implementation

- Specify stable IDs and ownership when a nested Updates block becomes a top-level element. Define how old layout version 3 profiles migrate and how removed blocks stay removed after round-tripping.
- Define whether groups are editor-only or map to native Components V2 Containers. Calculate nested component counts against Discord's 40-component limit, including accessories and gallery media.
- Define placeholder allowlists, escaping/mention neutralization, empty-value behavior, truncation, and per-feed visibility before exposing update data in arbitrary text.
- Define button action types, URL validation, authorization, disabled states, shared-versus-local settings, and compatibility with the existing reusable button definitions and signed Connect interactions.
- Specify preview/renderer parity and how existing persistent Discord messages are reconciled without changing their identity.

## Migration and release risks

- The current persisted layout contract is version 3 and accepts legacy versions 1 and 2. Any new persisted shape needs an explicit forward migration and legacy hydration path; silently rewriting all saved profiles is out of scope.
- Reparenting Updates blocks can change ordering, separators, empty-feed suppression, and accessory placement. Migration must preserve all of those values and stable IDs.
- Generic nesting can exceed Discord's hard component budget or create structures that the API rejects. Validate the complete tree before save and again before publication.
- Arbitrary placeholders expand the user-controlled content surface. Resolve values as text, sanitize mentions, preserve Markdown rules, and test malformed or missing feeds.
- Button schema changes can affect signed Connect behavior, external links, and deployment reconciliation. Add contract and live payload checks before release.

## Acceptance gate

Approve Phase 3 only after a migration matrix, profile fixtures for every supported version, renderer/component-budget tests, editor preview tests, and a deployment/reconciliation plan are reviewed. Existing version 3 data and current Discord messages must remain unchanged until an operator saves or explicitly applies a migration.
