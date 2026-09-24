# Troubleshooting

## Ubuntu installer fails

- Run it from the repository checkout with `sudo bash scripts/setup-ubuntu.sh`.
- Confirm the host is Ubuntu and can reach Docker's, Caddy's, and Ubuntu's package repositories.
- Confirm the domain already resolves to the server and inbound TCP 80/443 is open before public HTTPS verification.
- For application failures, inspect `docker compose logs --tail=100 app`.
- For certificate/proxy failures, inspect `journalctl -u caddy -n 100`.
- A successful local readiness check with failed public readiness usually indicates DNS, firewall, NAT, or Caddy certificate issuance trouble.
- Preserve an existing `.env` on rerun unless intentionally rotating secrets through a planned migration.

## Slash commands are missing

- Run `corepack pnpm discord:register`; normal application startup does not register commands.
- Confirm `DISCORD_TOKEN` and the 17-20 digit `DISCORD_CLIENT_ID` identify the same application.
- Confirm the bot was invited with both `bot` and `applications.commands` scopes.
- Global command updates can take time to propagate after Discord accepts registration.

## Initial configuration is rejected

- The first `/match admin configure` must be run by a member with Discord's native Administrator permission because no configured bot administrator role exists yet.
- Later configuration can be performed by a native administrator or the configured administrator role.
- Confirm all selected channels and roles still exist and the bot has the channel permissions listed in [Permissions](permissions.md).
- Confirm the requested game profile exists and is enabled. Run the seed command if `competitive_5v5` is absent.

## Managed setup or teardown is interrupted

Run `/match admin diagnostics`. An empty `SETTING_UP/RESERVED` state is recoverable through `/match admin recover-setup`. A `*_CREATE_IN_FLIGHT` state is ambiguous: inspect Discord and its audit log, manually remove any untracked resource from that attempt, then use the signed recovery acknowledgement. The bot never adopts or deletes same-named resources.

If teardown partially fails, settings remain disabled and only unresolved managed IDs remain. Restore Manage Channels/network access and rerun `/match admin teardown`. Teardown archives and locks channels rather than deleting them, and refuses while any active match or cleanup owns the guild slot.

Administrative confirmations expire after five minutes and require the same initiating user. Every bot instance must use the same persistent `MATCH_TOKEN_SIGNING_SECRET`.

## Match creation is rejected

- Run `/match admin status` and `/match admin diagnostics`.
- The guild must be enabled with a default profile and accessible configured lobby text channel.
- Only configured privileged, moderator, or administrator roles can create a match.
- PostgreSQL permits exactly one active guild slot. If an old terminal match still owns it, finish cleanup rather than manually creating another match.

## The panel did not appear where the command was run

This is expected when `/10man create` is invoked outside the configured lobby text channel. The persistent panel is always sent to the configured lobby channel. The command response identifies that channel.

If publication fails, creation is compensated to a failed non-active match. Fix channel existence and bot permissions, run diagnostics, and create again.

## Panel controls are stale or fail

Component IDs are signed and bound to a match version. Any roster, profile, team, map, or state change can invalidate an older component. Use the refreshed persistent panel or `/10man status`.

Team assignment is two-step: select a participant, then use the ephemeral Team 1 or Team 2 buttons. If the participant leaves or the match version changes between those steps, select again.

If the persistent message was deleted, enqueue `MATCH_DASHBOARD_REFRESH` or restart to trigger recovery. If its channel was deleted, reconfigure the guild first.

## An interaction returns a reference ID

The reference is the Discord interaction ID. Search structured logs for `interactionId` and inspect the associated error, guild, user, command, match audit history, and job state. Do not ask users to share Steam callback URLs or connect passwords.

## Profile selection fails or resets setup

- Disabled profiles are intentionally hidden and rejected.
- A profile cannot be selected when its capacity is below the current roster size.
- A successful profile change resets team-selection progress and clears a selected map that is not allowed by the new profile.
- Refresh stale controls after any profile change.

## Voice moves do not happen

- Verify `Move Members`, `Connect`, and `View Channel` in the lobby and both team voice channels.
- Confirm configured channel IDs remain valid.
- Inspect the `VOICE_RECONCILE` job and logs. Voice failure during cleanup can keep cleanup retrying and the guild slot blocked.

## DatHost duplicate fails or is ambiguous

- Never issue an untracked manual duplicate after a timeout; DatHost may have completed the first request.
- Inspect the latest `ProvisioningAttempt` and reconcile by persisted server ID, ownership marker, provisional name, location, and request time.
- Confirm both global and guild template IDs are correct and refer to the protected template.
- An ambiguous attempt requires operator review; automatic cleanup remains conservative.

After retry exhaustion, the match becomes `FAILED`. If any external resource may exist, cleanup remains pending and the guild slot stays blocked until safe cleanup completes.

## Server stays in booting or ready

- `SERVER_BOOTING` means DatHost still reports booting or has not supplied connection data.
- `SERVER_READY` means connection data exists and MatchZy loading is the remaining step.
- Inspect the `POLL_SERVER_BOOT` job, DatHost state, credentials, and console response.
- Startup recovery supports both states. Do not manually rewrite transition history.

## MatchZy config does not load

- Verify `PUBLIC_BASE_URL` is public HTTPS and reachable from the game server.
- The authenticated config endpoint is `GET /internal/matches/:matchId/matchzy-config` with `x-matchzy-token`.
- The event endpoint is `POST /webhooks/matchzy/:matchId` with its scoped event token.
- Confirm MatchZy 0.8.15 and CounterStrikeSharp 1.0.342 are installed on the template.
- Tokens are scoped, expiring, server-bound, and rotated during loading; an old token should fail.

## Score does not update

`round_end` and `map_result` events persist score and enqueue an idempotent dashboard refresh. Check webhook authentication, the external-event journal, the corresponding `MATCH_DASHBOARD_REFRESH` job, and Discord message permissions. Invalid score JSON is rendered as unavailable rather than crashing the dashboard.

## Missed match end

The recurring `MATCHZY_RECONCILE` job marks a match finished and queues cleanup when the server disappears without `series_end`. If the server remains on but events are stale, reconciliation records and logs the observation without forcing an outcome; inspect MatchZy and DatHost logs.

Confirm the recurring job is `PENDING` with a future `run_at` after each success, not permanently `COMPLETE`.

## Cleanup did not delete the server

- A missing disposable server is treated as successful cleanup.
- Verify the persisted server ID matches the owned resource and is not a protected template ID.
- Inspect match cleanup status and the `CLEANUP_MATCH` job's attempts and `last_error`.
- Correct the underlying problem, reset cleanup work to `PENDING`, and confirm completion releases the guild slot.

## Steam assignment fails

- Accepts a SteamID64, `steamcommunity.com` profile URL, or `steamcommunity.com/id/<vanity>` URL; vanity resolution requires `STEAM_API_KEY`.
- Assignment is intentionally blocked while the user is in the queue or protected by an active locked/live match.
- A Steam ID already assigned to another Discord user opens an assignment dispute; staff resolve it with `/match admin steam-disputes` and `/match admin resolve-steam-dispute`.
