# TenMan live beta test guide

Use this runbook to prove the real Discord, DatHost, and MatchZy integration before inviting normal players. It is a **staging acceptance run**, not a production match procedure.

Do not use the production Discord guild, production database, production DatHost template, or real player Steam accounts. The run deliberately creates and deletes one disposable CS2 server.

## 1. Prepare a safe staging scope

1. Create a staging Discord guild and invite only the bot, operators, and ten test players.
2. Create an empty, disposable PostgreSQL database for this deployment. The current migration baseline must not be applied to an older installation.
3. Create one stopped DatHost CS2 template for staging. Protect that template from deletion and configure it exactly as described in the [DatHost template guide](../dathost-template-setup.md).
4. Verify the template has the pinned MatchZy and CounterStrikeSharp versions, GOTV enabled, MatchZy whitelist/no-match lockout enabled, and no permanent player/admin credentials.
5. Set the staging deployment's `PUBLIC_BASE_URL` to a publicly reachable HTTPS origin. It must be reachable from a DatHost game server, not merely from the bot host.
6. Keep a record with the staging guild ID, template server ID, deployment revision, and operator. Do not put passwords, tokens, RCON values, or join passwords in that record.

Stop here if any identifier points at production.

## 2. Deploy and verify the staging bot

On the staging host, complete the normal deployment procedure in the [operations runbook](../operations.md). Use the staging environment file and database only.

Then verify:

1. `corepack pnpm prisma:validate` succeeds.
2. `corepack pnpm prisma:migrate:deploy` succeeds against the staging database.
3. `corepack pnpm prisma:seed` creates the `competitive_5v5` profile.
4. `corepack pnpm discord:register` completes and `/match` appears in the staging guild.
5. `/health/live` and `/health/ready` both return HTTP 200.
6. With a separately migrated disposable test database in `TEST_DATABASE_URL`, run `corepack pnpm test:tenman:simulation`. It must pass; the command intentionally refuses to run without that variable.

The simulation is a database and fake-provider check. It does not replace the remaining steps in this guide.

## 3. Configure the staging guild

1. Give the bot the Discord intents and permissions listed in [Discord setup](../discord-setup.md), including access to manage the staging channels, messages, and voice states.
2. As a native Discord Administrator, run `/match config setup`. Select the staging privileged, moderator, and administrator roles; provide the **staging** DatHost template ID and the intended DatHost location.
3. Confirm that only the expected managed Competitive category and child channels were created.
4. Run `/match config status`, then `/match admin diagnostics`. Resolve every reported channel, role, permission, profile, or template failure before continuing.
5. Run `/match config enable`, then `/match admin queue-panel` to create the durable queue panel.

Do not manually create substitute channels by matching names. Use the managed setup/recovery controls so ownership remains durable.

## 4. Prepare the ten test players

1. Have each test account open `/match account` and assign its own unique SteamID64.
2. Confirm the ten Steam identities are distinct and belong to the staging participants.
3. Open the queue panel and confirm it shows zero of ten players.
4. Test one rejection before filling the queue: attempt a duplicate Steam assignment or a queue ban, then confirm the bot gives an actionable rejection without adding an entry.

Never use a shared Steam identity or a normal member's account as a test shortcut.

## 5. Run the queue and formation test

1. Have eight players join from the queue panel. Confirm the panel reaches 8/10.
2. Have the final two players press Join at nearly the same time. Confirm there is exactly one `READY_CHECK` match, one ready timeout, and a locked queue—not two matches.
3. Have all ten players accept the ready check. Confirm the dashboard advances to captain selection.
4. Select captains, complete all eight draft picks, and verify only the current captain can pick.
5. Complete the captain veto. Verify a single allowed map remains and that provisioning begins only after the final ban.
6. At one formation phase, try an old button or the wrong captain's control. Confirm it is rejected as stale or out of turn and that the match state does not change.

Record redacted screenshots of the queue, ready check, captain/draft screen, veto, and match dashboard. Do not capture connection secrets.

## 6. Prove real server provisioning and MatchZy

1. In DatHost, locate the new destination server. Confirm it is not the template, is in the requested location, and has a `user_data` value beginning with `tenman:`.
2. Confirm the destination is private, has eleven slots and GOTV enabled, and was created from the protected template.
3. Watch bot logs and the match dashboard until the state reaches `MATCH_LOADED`.
4. In the DatHost console, verify MatchZy loaded the match configuration. Do not copy the configuration URL, token, RCON password, or join password into chat or evidence.
5. Use the staging players to connect and start the match. Confirm MatchZy `series_start` and `going_live` advance the dashboard through warmup and live play.
6. Finish one short BO1. Confirm `series_end` records the final score exactly once; sending/receiving a duplicate terminal event must not apply rating changes twice.

If the duplicate request outcome is unknown or ambiguous, do **not** request another DatHost duplicate. Follow the [provisioning-failure procedure](../operations.md#unknown-or-ambiguous-duplicate-outcome).

## 7. Verify cleanup and recovery

1. After the result, confirm cleanup is pending, credentials are revoked, and the match slot remains held until cleanup completes.
2. Confirm the bot stops and deletes the exact disposable destination server. Verify the protected template still exists and was not reconfigured or deleted.
3. Confirm the match cleanup reaches `COMPLETE`, the guild slot releases, and the queue panel returns to `OPEN`.
4. Confirm the orphan scanner reports no unexplained staging servers.
5. Repeat a short run with one controlled restart while a forming phase or provisioning job is pending. On restart, confirm the dashboard, deadline, and durable job recover without creating a second server or second match.

If cleanup fails, keep the slot blocked, inspect the durable job and DatHost ownership information, and follow [cleanup failure and blocked guild slot](../operations.md#cleanup-failure-and-blocked-guild-slot). Do not manually unlock the queue while a disposable server might exist.

## 8. Record the acceptance result

For each item in the [staging acceptance checklist](../staging-checklist.md), record pass/fail, timestamp, operator, staging revision, and a redacted evidence link. A beta candidate is ready only when every applicable checklist item has passed or has an explicit, approved exception.

After the run, disable or tear down the staging configuration if the guild is not being kept for further testing. Preserve the protected template for the next run; delete only confirmed disposable destinations.
