# Managed game-server updates and displays

Game-server registration, monitoring, public visibility, and Discord displays are
separate controls. Registering an accessible DatHost CS2 server starts monitoring
but does not publish anything to Discord. A Discord display is a desired
deployment of one server card in one text channel; the same registration may have
displays in several channels.

Use the Game Servers admin page to publish, move, refresh/repair, or remove a
display. Removing a display deletes only the bot-managed message and its deployment
record; it does not unregister the DatHost server or stop polling. Moving creates
the destination first, then removes the source. If a managed message is deleted,
the desired deployment remains recorded and **Refresh / Repair** recreates it.

Making a server private removes its managed public displays. Unregistering a server
also removes its managed displays before the registration is deleted. Neither action
changes the DatHost server itself. The old single “panel destination” is deprecated;
there is no guild-wide card channel.

Each enabled, public displayed server has one canonical Announcements thread and one
canonical Changelog thread. Multiple card displays link to those same update threads;
they do not create per-channel copies. The card remains the index: Latest Updates
appears below Connect and Map & Rules in the same Components V2 message.

## Discord setup

- Use a regular guild text channel for the server cards and their public threads.
- Enable **Message Content Intent** in the application's Discord Developer Portal
  before starting the updated bot. Manual staff posts need this privileged intent
  to expose their text and attachments. Approved access is required where Discord
  requires privileged-intent review.
- Give the bot View Channel, Send Messages, Embed Links, Read Message History,
  Create Public Threads, Send Messages in Threads, and Manage Threads in the
  destination channel. Administrator is unnecessary.
- To make updates read-only for members, deny Send Messages in Threads to member
  roles on the parent channel, then allow it for the bot and publishing staff.
  Check other role overrides too. Threads inherit parent permissions; they cannot
  have independent permission overwrites. This affects every thread in that parent.
  The bot does not rewrite existing channel permissions automatically.

## Display and lifecycle

Phase 1 accepts manual posts from members with Administrator, Manage Server, or
Manage Messages permissions in the thread. Ordinary member replies, system
messages, all bot messages (including this bot's setup messages), and webhooks
are excluded. Automated official publishing needs an explicit future publishing
path; bot authorship alone never makes a message official.

Thread names include the server's stable ID after the readable server name and
thread type. This distinguishes servers with identical names and lets recovery
find a Discord thread created just before a database failure, even after a
display-name change.

Both rows remain visible when empty. A qualifying post shows a compact preview,
a Discord relative timestamp, and a direct thread link. Mentions in previews do
not ping anyone. The temporary `🆕` indicator expires 48 hours after the original
post time, independently for each row. Edits do not extend this window. Deleting
the latest post falls back to a previous qualifying post using its original time.

Threads use the supported seven-day auto-archive duration and may archive
naturally. Archived threads remain valid navigation targets. No bump, keepalive,
thread rename, or notification message is generated. Ordinary reconciliation
does not unarchive a thread. A legitimate publication can reopen it.

Startup and adding a card schedule durable reconciliation jobs. A read-only
reconciliation runs every 15 minutes to recover missed posts, edits, deletions,
and missing resources after disconnects. Card refreshes read only cached database
previews. Permission failures preserve stored state and use worker retries;
after correcting a persistent failure, restart to re-arm reconciliation.

Discord controls component spacing and link-button appearance. The implementation
uses native Sections and link buttons instead of the concept image's custom row
backgrounds or pixel positioning. The card stays within 40 total components and
the conservative 10-child Container limit documented by discord.js.

## Rollout checks

1. Enable the intent and verify parent-channel permissions before publication.
2. Apply the checked-in Prisma migration using the normal deployment migration
   procedure, regenerate the client during build, and restart the application.
3. Register a DatHost server and confirm no card is automatically published. Publish
   it to two approved text channels; confirm both cards share the canonical update
   threads and that restarting does not duplicate either cards or threads.
4. Delete one managed card manually, run **Refresh / Repair**, and confirm it is
   recreated in the same channel. Move the other display and verify the destination
   appears before the source is removed.
5. Make the server private and confirm managed public cards are removed while the
   DatHost registration remains. Re-publish only after making it public again.
6. Post a staff update in each thread. Check preview text, direct navigation,
   independent NEW indicators, and the unchanged Connect / Map & Rules controls.
7. Edit and delete the latest post; check that edits retain the deadline and
   deletion restores the previous eligible post without granting a new window.
8. Archive a thread and verify navigation and restart preserve its ID. Delete
   a managed thread and verify only that resource is replaced.
9. Verify expiry and worker health. The deadline is exactly post time plus 48
   hours; the visible Discord edit is subject to worker availability and API
   latency/rate limits. After downtime, expired indicators must not receive a new
   48-hour window.

Local unit tests validate payloads and lifecycle behavior. Live Discord rendering,
portal intent access, channel permissions, and production migration execution
must be checked in the deployment environment.

Implementation validation: `pnpm typecheck`, `pnpm lint`, `pnpm build`, Prisma
client generation/schema validation, and changed-file formatting checks passed.
The complete local test run passed 456 tests; 12 database-dependent tests were
skipped because `TEST_DATABASE_URL` was not configured. Prisma's schema-to-schema
migration diff confirmed that only the requested enum/table, indexes, and cascade
relation are added. The new database suite is included in `pnpm test:database`.
No production migration or live Discord acceptance run was performed.

## Verified API references

- [Discord component reference](https://docs.discord.com/developers/components/reference)
  documents native Sections, link buttons, relative content, and the 40-component
  message limit.
- [discord.js Container interface](https://discord.js.org/docs/packages/core/2.2.1/APIContainerComponent:Interface)
  documents the conservative ten-child Container limit.
- [Discord threads](https://docs.discord.com/developers/topics/threads) describes
  inherited permissions and thread lifecycle.
- [Discord channels](https://docs.discord.com/developers/resources/channel)
  specifies supported auto-archive durations and thread creation.
- [Discord Gateway intents](https://docs.discord.com/developers/events/gateway#message-content-intent)
  describes privileged Message Content access.
