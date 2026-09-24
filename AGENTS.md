# Office Club Discord Bot Suite Workflow Context

## Live deployment and staging target

- Connect with `ssh tablet@192.168.1.175`.
- The live deployment checkout is `/opt/office-club-discord-bot-suite` on the Ubuntu host.
- The user refers to this server/workspace as `O:\\`; use the verified Linux path above for SSH commands.
- The bot runs through Docker Compose. Inspect the current checkout and Compose state before each deployment; do not expose or modify server-side secrets.
- For a deployed change, pull the intended committed revision, run the documented migration/build/restart sequence appropriate to the checked-in Compose configuration, and verify container health and bot startup logs afterward.
