# 10man competitive QoL implementation plan

## Purpose and release boundary

Improve the player experience without changing competitive CS2 rules, creating a second match controller, exposing server credentials, or weakening the existing durable ownership and cleanup model.

The first supported release is deliberately **BO1, 5v5, ten Steam-linked players, and one GOTV slot**. MatchZy is the sole match controller; DatHost supplies disposable infrastructure only. Do not enable BO3, generic player-count profiles, live substitutions, coaching, spectators, player RCON, skins, practice plugins, or DatHost Match API in this release.

Results are called **points** and W/L records. The current fixed +/-25 result is not calibrated matchmaking rating.

## Delivery principles

- Resolve release/migration gates before adding QoL schema or jobs.
- Prefer existing signed controls, PostgreSQL transactions, durable jobs, and owned Discord-resource reconciliation over parallel systems.
- Make every external operation idempotent and bounded; a missing demo must not lock the guild queue forever.
- Never put an address, join password, RCON secret, provider path, or storage URL in a public embed, ordinary DM, log, custom ID, job payload, or audit metadata.
- Build the narrowest feature slice, test it, run it in staging, and only then start the next slice.

## Implementation status (2026-09-20)

- **Phase 0.1 complete locally:** the competitive profile contract is enforced at setup, queue admission, and provisioning.
- **Phase 1 complete locally:** the durable dashboard shows grouped rosters and score state; score refreshes are coalesced; signed `My Match Info` replies are participant-only and decrypt only after the active-state/cleanup checks pass.
- **Phase 2 and Phase 3 intentionally blocked:** no results-channel configuration or private object-storage policy has been selected. The current cleanup deletes every owned match resource, so a receipt cannot safely be represented as an ordinary disposable resource. Demo collection cannot safely begin until DatHost file-list/download staging and the storage policy are proven.

## Phase 0: release and staging gates

### 0.1 Freeze and enforce the mode contract

1. Add an explicit enabled-profile validation that rejects anything outside competitive BO1 5v5 for this release.
2. Ensure dashboard, draft, veto, provisioning, and artifact assumptions all derive from that contract.
3. Keep the normal MatchZy policy: whitelist/no-match lockout, demo recording, GOTV, no universal admin, two 300-second tech pauses, mutual unpause, and player `.stop` disabled.
4. Set `matchzy_allow_force_ready false` unless an intentionally configured and staging-proven staff-only MatchZy identity requires it.

### 0.2 Establish the database baseline

Before feature migrations, decide whether this is fresh-install-only or supports upgrade from a deployed legacy database.

- Fresh install: document a reviewed import/manual migration path for old data.
- Upgrade support: create a forward-only migration from a sanitized representative database.

Required proof:

- `prisma migrate deploy` against an empty PostgreSQL database.
- The same against the representative upgrade database when upgrades are supported.
- Prisma CRUD smoke coverage for settings, queue, match, event journal, credentials, jobs, and cleanup.
- Node 22 typecheck, build, unit, contract, and integration tests.
- Recovery procedure based on application rollback/database restore, never destructive schema reversal.

### 0.3 Complete one real staging lifecycle

Use the protected template and one disposable staging duplicate. Record redacted evidence for:

- Template plugin health and protected-template immutability.
- Authenticated MatchZy config load.
- Exactly ten rostered Steam identities accepted; an eleventh/non-rostered identity rejected.
- Readiness, captain draft, veto, knife/side, tech pause, normal series end, duplicate/out-of-order events, and bot restart behavior.
- Points applied once, cleanup restricted to the owned duplicate, and queue reopening only after safe cleanup.

Do not expose Discord staff pause/restore controls in player policy until a separate staged feature has implemented and audited them.

## Phase 1: information-only player QoL

### 1.1 Dashboard clarity

Extend the current durable match dashboard rather than creating a second message system.

Show phase, grouped team rosters once teams are finalized, acting captain, draft/veto sequence, deadline, chosen map, banned maps, and persisted score. Use `Score pending` until MatchZy has supplied a durable score.

Implementation safeguards:

- Add renderer snapshot tests for long display names, full map pools, missing scores, and terminal states.
- Enforce Discord field/component limits and truncation.
- Persist or deterministically calculate a render hash and last-render timestamp so unchanged payloads are not edited.
- Coalesce routine round-score edits to one per 5-10 seconds; force immediate phase-change/final-result updates.
- Do not show `Paused` until pause events and state reconciliation are implemented.

### 1.2 Private `My Match Info`

Add `MY_MATCH_INFO` to the existing signed `tmm:` component namespace. The handler must verify guild, component signature/version/generation, current roster membership, active non-cleanup state, and then decrypt the join secret only for the ephemeral reply.

Allowed state: `SERVER_READY`, `MATCH_LOADED`, `WARMUP`, `LIVE`, and a future implemented `PAUSED` state. The response may show team, map, voice destination, connect address, and join password. It must be unavailable after terminal state or cleanup begins.

Required negative tests: nonparticipant, wrong guild, tampered/stale component, terminal match, cleanup-held match, and secrets absent from logs/audit/jobs/custom IDs.

## Phase 2: retained results

Create a distinct `MATCH_RESULT_RECEIPT` owned Discord resource in a configured results channel. Do not reuse the terminal dashboard: normal match cleanup deletes ephemeral match resources.

The receipt is idempotently created after durable result persistence and shows final series result, map, roster, points change, match ID, and artifact state. It begins as `Demo processing` or `Demo unavailable`; later updates are idempotent. Define explicit retention and cleanup semantics for receipts separately from match channels.

## Phase 3: demo and artifact retention

### 3.1 Data model

Extend **`DemoReference`** as the sole artifact authority; do not create a competing model. Add map number, source filename, explicit lifecycle status, private storage key, byte count, SHA-256, retry/error information, observed timestamp, and retention timestamps. For BO1, enforce one authoritative demo per match/map number.

Statuses:

```text
EXPECTED -> SOURCE_READY -> TRANSFERRING -> STORED
                       \-> UNAVAILABLE | FAILED | EXPIRED
```

### 3.2 Collection and cleanup choreography

1. On `series_end`, persist the result and expected demo record, post the receipt, and enqueue `COLLECT_MATCH_ARTIFACTS`.
2. `demo_upload_ended` only marks source availability and queues/retries collection; it never supplies a trusted path by itself.
3. Stream from the verified owned duplicate to private S3-compatible storage. Validate a sanitized expected source path, maximum size, streamed byte count, and SHA-256 before marking `STORED`.
4. Permit `CLEANUP_MATCH` only after each expected artifact is terminal or a measured hard collection deadline expires.
5. Immediately before delete, cleanup rechecks terminal artifact status under a compare-and-set claim. Late/duplicate events cannot reopen cleanup.
6. Deadline expiry records `EXPIRED` or `UNAVAILABLE`, emits an audited staff-visible outcome, then releases the queue. Collection can never delay the guild indefinitely.

Use a bot-pull transfer: the bot lists and streams files from the verified owned DatHost duplicate using its account-scoped API credential, then writes to the selected private object store. Use separate participant/staff-authorized short-lived download links. Never use a public MatchZy ingest endpoint, raw provider links, local bot-disk persistence, permanent object URLs, or MatchZy event tokens for download access.

### 3.3 Artifact gates

Before enablement, decide storage provider, retention period, byte cap, expected demo count, and participant-versus-staff historical access policy. Stage a real MatchZy 0.8.15 demo callback, transfer, hash verification, authorized download, slow upload, failed upload, and collection-timeout release.

## Phase 4: opt-in conveniences

Add only after result and artifact behavior are stable:

- Queue alerts backed by a per-guild/player preference and durable delivery key; upward thresholds only, opt-in, no mass mentions, delivery failure never affects queue promotion.
- Private self-status for queue position, party, active deadline, and required action.
- History polish: last five, map record, streak, and a documented privacy policy for viewing another member's history.
- Region display only. Do not add ping-based routing until independently staged.

## Staff-control follow-up (optional)

If Discord staff pause/unpause/restore is required, implement it as a distinct feature after Phase 1:

- configured moderator permission;
- explicit confirmation and stale-control rejection;
- match/guild/phase authorization;
- audited intent and outcome;
- idempotency key and exact semantic MatchZy command allowlist;
- no raw RCON;
- pause/restoration state reconciliation before dashboard claims.

## Test matrix and release exits

Every phase must add unit, integration, recovery, and staging evidence before the next begins.

| Area            | Required proof                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Database        | clean deploy, supported upgrade deploy, Prisma smoke coverage                                                   |
| Match integrity | roster lock, ready threshold, draft/veto, knife/side, tech-pause limits                                         |
| Dashboard       | embed limits, stale components, score ordering/duplicates, edit coalescing                                      |
| Secrets         | roster/state authorization, ephemeral-only output, redacted observability                                       |
| Results         | idempotent receipt creation, result reversal behavior, receipt retention                                        |
| Artifacts       | before/after series event order, duplicate events, checksum/size failure, storage crash, deadline, cleanup race |
| Recovery        | worker restart, lease/concurrent job behavior, failed Discord send, failed server deletion                      |
| Ownership       | template untouched, only persisted owned duplicate deleted                                                      |

## Agent allocation and credit discipline

Use agents only for independent, bounded reviews or a high-risk implementation slice. The primary implementer owns integration and final decisions.

| Task                                        | Agent profile                                                 | Why this is the right cost/quality tradeoff                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration inventory and test design         | Default agent, low reasoning                                  | Mostly evidence gathering and focused test planning. Escalate only if an actual legacy schema is found.                                                                                 |
| BO1/5v5 contract enforcement                | Default agent, low reasoning                                  | Small, localized validation and tests.                                                                                                                                                  |
| Dashboard and `My Match Info`               | Default agent, medium reasoning                               | Crosses Discord authorization, encrypted credentials, and renderer limits. One focused reviewer is warranted.                                                                           |
| Result receipt                              | Default agent, medium reasoning                               | Requires durable resource ownership/recovery but no external storage.                                                                                                                   |
| Artifact state machine/storage/cleanup gate | Strongest available agent, high reasoning, one bounded review | This is the highest-risk area: external I/O, data retention, concurrent jobs, and server deletion. Use one design review plus one implementation review, not parallel duplicate coding. |
| Queue alerts/history polish                 | Default agent, low reasoning                                  | Isolated preferences/query/UI work after core lifecycle stabilizes.                                                                                                                     |
| Final release review                        | Strongest available agent, high reasoning                     | One evidence-based review of migrations, security, recovery, and staging results before promotion.                                                                                      |

Avoid agent duplication: do not send multiple agents to read the same files or implement the same feature. Do not escalate reasoning for renderer copy, simple preference CRUD, or formatting. Run narrow tests after each slice; run full staging only at phase exits.
