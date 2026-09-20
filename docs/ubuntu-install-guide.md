# Ubuntu Automated Setup Guide

This guide deploys the 10Man bot on an Ubuntu server by using `scripts/setup-ubuntu.sh`. It covers every prerequisite, installer prompt, automated action, Discord and DatHost setup step, verification check, and post-install task required for a working bot and owner web panel.

## 1. What the installer deploys

The installation consists of:

- The Discord bot and Fastify HTTP application in a Docker container.
- PostgreSQL 17 in a separate Docker container with persistent storage.
- Caddy on the Ubuntu host for automatic public HTTPS.
- An owner-only web panel at `https://your-domain/admin`.
- Steam OpenID callback routes and authenticated MatchZy endpoints.
- Global Discord slash commands.

Docker publishes the application only on `127.0.0.1:3000`. Caddy is the public entry point on ports 80 and 443.

## 2. Requirements

Prepare all of the following before running the installer:

- An Ubuntu server with root or sudo access.
- A public IPv4 address for the server.
- A domain or subdomain you control, such as `10man.example.com`.
- Permission to edit the domain's DNS records.
- Inbound TCP ports 22, 80, and 443 permitted by the hosting provider or cloud firewall.
- A Git repository URL and permission to clone this project.
- A Discord account that can create an application and manage the target Discord guild.
- The Discord user ID of each person allowed to use the owner panel.
- A DatHost account and its email and password.
- A protected DatHost CS2 template server configured with MatchZy 0.8.15 and CounterStrikeSharp 1.0.342.

The script supports Ubuntu only. It must be run from a repository checkout with `compose.yaml` and `Dockerfile` present.

## 3. Prepare the DatHost template

Complete this before installation because the script asks for the template server ID and DatHost credentials.

1. Sign in to the [DatHost panel](https://dathost.net/).
2. Create a CS2 server that will be used only as a template.
3. Install MatchZy 0.8.15 and CounterStrikeSharp 1.0.342.
4. Keep the template configuration minimal. The bot configures each duplicated destination's slots, name, location, passwords, GOTV/private settings, autostop, and ownership marker.
5. Record the exact DatHost template server ID.
6. Do not use this template server for live matches and do not substitute a disposable server ID later.

The DatHost account supplied to the installer must be able to read the template, create and duplicate servers, configure destinations, start servers, and delete bot-owned disposable destinations.

See [DatHost Template Setup](dathost-template-setup.md) and [MatchZy Integration](matchzy-integration.md) for the complete template requirements.

## 4. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select **New Application** and give the application a name.
3. Open **Bot** and create the bot user if Discord has not already done so.
4. Reset or reveal the bot token and store it securely. The installer requests it as the **Discord bot token**.
5. Open **General Information** and copy the **Application ID**. It is a 17–20 digit value requested as the **Discord application ID**.
6. Open **OAuth2 → General** and reset or reveal the **Client Secret**. Store it securely. The installer requests it as the **Discord OAuth client secret**.
7. Under **OAuth2 → Redirects**, add the exact callback URL for the domain you will deploy:

   ```text
   https://10man.example.com/admin/auth/callback
   ```

   Replace `10man.example.com` with the real domain. The scheme must be `https`, the path must be `/admin/auth/callback`, and there must be no extra trailing slash.

The panel requests only the Discord OAuth `identify` scope. The OAuth client secret and bot token are different credentials; both are required.

Do not commit these credentials, paste them into Discord, or include them in screenshots. The installer stores them in a root-controlled `.env` file with mode `600`.

## 5. Obtain the owner Discord user ID

The owner panel accepts only Discord users listed during installation.

For each owner:

1. Open Discord **User Settings → Advanced**.
2. Enable **Developer Mode**.
3. Right-click the user's account or profile.
4. Select **Copy User ID**.

Each ID must contain 17–20 digits. For multiple owners, prepare a comma-separated value with no names:

```text
12345678901234567,23456789012345678
```

This is separate from the Discord application ID.

## 6. Invite the bot to the Discord guild

In the Discord Developer Portal:

1. Open **OAuth2 → URL Generator**.
2. Select these scopes:
   - `bot`
   - `applications.commands`
3. Select these bot permissions:
   - View Channels
   - Send Messages
   - Embed Links
   - Read Message History
   - Connect
   - Move Members
   - Manage Channels
4. Open the generated URL.
5. Select the target Discord guild and authorize the bot.

`Manage Channels` is required for `/match admin setup`, setup recovery, and managed teardown. The bot deletes only channel IDs that it has persisted as bot-owned.

The person who performs the first guild setup must have Discord's native **Administrator** permission. A configured bot administrator role does not exist yet.

## 7. Create the Discord roles

Create these three roles before configuring the guild:

- **10Man Player** — members allowed to create a 10man.
- **10Man Moderator** — staff allowed to override match controls and manage participants.
- **10Man Administrator** — staff allowed to configure and administer the bot.

The role names are suggestions. Assign the appropriate members to each role. The setup command or owner panel will ask you to select them.

## 8. Configure DNS and network access

At your DNS provider, create an `A` record that points the chosen hostname to the Ubuntu server's public IPv4 address.

Example:

```text
Type: A
Name: 10man
Value: 203.0.113.10
TTL: 300
```

Add an `AAAA` record only if the Ubuntu server has correctly routed public IPv6.

Verify DNS from your computer:

```bash
nslookup 10man.example.com
```

The returned address must be the Ubuntu server. DNS must be working before the installer reaches Caddy verification.

At the hosting provider or cloud firewall, allow:

- TCP 22 from the addresses that need SSH access.
- TCP 80 from the internet for HTTP validation and redirect handling.
- TCP 443 from the internet for HTTPS.

Do not expose PostgreSQL or port 3000 publicly. The Compose configuration binds port 3000 to loopback only.

If Ubuntu UFW is already active, the script adds rules for OpenSSH and TCP 80/443. It does not enable UFW when UFW is inactive.

## 9. Connect to Ubuntu and clone the project

Connect over SSH:

```bash
ssh your-user@your-server-ip
```

Install Git if it is not already installed:

```bash
sudo apt update
sudo apt install -y git
```

Clone the repository and enter its root directory:

```bash
git clone <repository-url> 10manbot
cd 10manbot
```

Confirm that the installer and Compose file are present:

```bash
ls scripts/setup-ubuntu.sh compose.yaml Dockerfile
```

The script determines the project directory from its own location, but it refuses to run unless the repository contains `compose.yaml` and `Dockerfile`.

## 10. Run the installer

From the repository root, run:

```bash
sudo bash scripts/setup-ubuntu.sh
```

The script must run as root. Running it without `sudo` stops with an error.

### Installer prompts on a new deployment

Enter these values when prompted:

1. **DNS-ready domain for this bot**
   - Enter only the hostname, such as `10man.example.com`.
   - Do not include `https://`, a path, or a trailing slash.
   - The script validates that it looks like a fully qualified domain.
2. **Discord bot token**
   - Paste the token from the Discord application's Bot page.
   - Input is hidden.
3. **Discord application ID**
   - Enter the 17–20 digit Application ID.
4. **Discord OAuth client secret**
   - Paste the secret from OAuth2 → General.
   - Input is hidden.
5. **Comma-separated owner Discord user IDs**
   - Enter one or more numeric user IDs, separated by commas.
6. **DatHost account email**
   - Enter the email used to authenticate to DatHost.
7. **DatHost account password**
   - Enter the DatHost password.
   - Input is hidden.
8. **DatHost template server ID**
   - Enter the exact protected template ID prepared earlier.

Every prompt requires a non-empty, single-line value. The script performs basic validation on the domain, Discord application ID, and DatHost email. Application startup performs stricter validation of the complete generated environment, including the owner user IDs and secret lengths.

## 11. What the installer runs

The script performs these operations in this exact order.

### 11.1 Validate the host and checkout

It verifies that:

- The effective user is root.
- `compose.yaml` and `Dockerfile` exist in the project.
- `/etc/os-release` is readable.
- The operating-system ID is `ubuntu`.

It enables noninteractive APT behavior for package installation.

### 11.2 Install base packages

It runs:

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg openssl
```

These packages support HTTPS package repositories and secret generation.

### 11.3 Install Docker Engine and Compose

If both Docker and `docker compose` already work, this step is skipped.

Otherwise, the script:

1. Adds Docker's official Ubuntu signing key.
2. Adds Docker's official repository for the server architecture and Ubuntu codename.
3. Updates APT.
4. Installs:
   - `docker-ce`
   - `docker-ce-cli`
   - `containerd.io`
   - `docker-buildx-plugin`
   - `docker-compose-plugin`
5. Enables and starts the Docker service.

### 11.4 Install Caddy

If the `caddy` command already exists, installation is skipped.

Otherwise, the script:

1. Adds Caddy's official stable signing key and APT repository.
2. Updates APT.
3. Installs Caddy.

### 11.5 Generate and write `.env`

For a new installation, the script generates:

- A random PostgreSQL password.
- A random Discord-component and administrative-confirmation signing secret.
- A separate random panel OAuth-state/CSRF signing secret.
- A random 32-byte base64 credential-encryption key.

It writes `.env` in the repository root with:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
POSTGRES_PASSWORD=<generated>
DATABASE_URL=postgresql://postgres:<generated>@postgres:5432/tenman
DISCORD_TOKEN=<entered>
DISCORD_CLIENT_ID=<entered>
DISCORD_CLIENT_SECRET=<entered>
PANEL_OWNER_DISCORD_USER_IDS=<entered>
PANEL_SESSION_SECRET=<generated>
DATHOST_EMAIL=<entered>
DATHOST_PASSWORD=<entered>
DATHOST_TEMPLATE_SERVER_ID=<entered>
PUBLIC_BASE_URL=https://<entered-domain>
MATCH_TOKEN_SIGNING_SECRET=<generated>
CREDENTIAL_ENCRYPTION_KEY=<generated>
DEFAULT_DATHOST_LOCATION=
WORKER_POLL_INTERVAL_MS=1000
MATCHZY_RECONCILIATION_INTERVAL_MS=30000
MATCHZY_STALE_AFTER_MS=120000
```

The file is created with a restrictive umask and changed to mode `600`.

Do not delete or casually regenerate `.env`. The database password, encrypted match credentials, signed Discord controls, panel security, and callbacks depend on its persistent values.

### 11.6 Configure Caddy

The script creates `/etc/caddy/Caddyfile.d/10manbot.caddy` containing a site for the chosen domain:

```caddyfile
10man.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

It ensures the main `/etc/caddy/Caddyfile` imports `Caddyfile.d/*`, formats both files, validates the complete Caddy configuration, enables Caddy, and restarts it.

Caddy automatically obtains and renews the HTTPS certificate. DNS and public ports 80/443 must already be correct.

### 11.7 Configure an active UFW firewall

When UFW is installed and already active, the script runs equivalent rules for:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
```

The installer does not activate an inactive firewall and does not modify an external cloud firewall.

### 11.8 Build the application image

From the project directory, it runs:

```bash
docker compose build --pull
```

This pulls current base images, installs the lockfile dependencies, generates the Prisma client, and compiles the TypeScript application inside the Node 22 build image.

### 11.9 Start PostgreSQL

It runs:

```bash
docker compose up -d postgres
```

Compose creates the `tenman` database and stores PostgreSQL data in the persistent `postgres-data` Docker volume. The application waits for the PostgreSQL health check.

### 11.10 Apply database migrations

It runs:

```bash
docker compose --profile tools run --rm db-tools
```

This applies all pending production migrations, including tables, indexes, active-guild-slot safeguards, managed-resource state, and owner-panel sessions.

If migration deployment fails, the script stops. Review the migration error before retrying; do not bypass a data-integrity check.

### 11.11 Seed game profiles

It runs:

```bash
docker compose --profile tools run --rm db-tools corepack pnpm prisma:seed
```

This creates or updates the built-in enabled game-profile records needed for guild configuration. Seeding is designed to be safe on reruns.

### 11.12 Register Discord slash commands

It runs:

```bash
docker compose run --rm app node dist/register-commands.js
```

This registers the application's global slash commands with Discord using `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Normal application startup does not register commands automatically.

Global command changes can take time to appear in Discord.

### 11.13 Start the application

It runs:

```bash
docker compose up -d app
```

The application container uses `restart: unless-stopped`, reads the generated `.env`, connects to PostgreSQL, serves HTTP on container port 3000, logs in to Discord, runs startup recovery, and starts the durable worker.

### 11.14 Verify local readiness

The script checks this endpoint up to 60 times, waiting two seconds between attempts:

```text
http://127.0.0.1:3000/health/ready
```

If the service never becomes ready, it prints the last 100 application log lines and exits with an error.

### 11.15 Verify public HTTPS readiness

After local readiness succeeds, the script checks this endpoint up to 30 times, waiting two seconds between attempts:

```text
https://your-domain/health/ready
```

If public verification fails, it prints recent Caddy logs and asks you to check DNS, ports 80/443, and Caddy. If it succeeds, installation ends with a ready message.

## 12. Verify the deployment manually

Show both containers and their status:

```bash
sudo docker compose ps
```

Inspect application logs:

```bash
sudo docker compose logs --tail=100 app
```

Inspect PostgreSQL logs if database startup or migration failed:

```bash
sudo docker compose logs --tail=100 postgres
```

Check local endpoints from Ubuntu:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
```

Check public HTTPS:

```bash
curl -i https://10man.example.com/health/ready
```

Expected ready response:

```json
{ "status": "ready" }
```

Check Caddy when HTTPS fails:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

## 13. Open and verify the owner panel

Open:

```text
https://10man.example.com/admin
```

1. Select **Sign in with Discord**.
2. Authorize the `identify` request.
3. Sign in with a Discord user ID entered in `PANEL_OWNER_DISCORD_USER_IDS`.
4. Confirm that the panel lists every guild currently connected to the bot.

If Discord reports an invalid redirect URI, compare the Developer Portal entry against:

```text
https://10man.example.com/admin/auth/callback
```

The values must match exactly.

A non-allowlisted Discord user receives no guild configuration access. Panel sessions last eight hours and can be ended with **Log out**.

## 14. Wait for Discord slash commands

In the target guild, type:

```text
/match admin status
```

If `/match` is absent:

1. Wait for global command propagation.
2. Confirm that the bot was invited with `applications.commands`.
3. Confirm the application ID and bot token belong to the same Discord application.
4. Review the installer output.
5. Rerun command registration if necessary:

   ```bash
   sudo docker compose run --rm app node dist/register-commands.js
   ```

## 15. Configure the Discord guild

Choose one setup method.

### Option A: Create managed channels in Discord

As a native Discord administrator, run:

```text
/match admin setup
```

Provide:

- `privileged_role`: the role allowed to create 10mans.
- `moderator_role`: the role allowed to override match controls.
- `administrator_role`: the role allowed to administer the bot.
- `dathost_template_server_id`: the same protected DatHost template ID used during installation.
- `dathost_location`: optional; defaults to `dallas`.
- `default_game_profile`: optional; defaults to `competitive_5v5`.

The bot creates:

```text
10Man
├── #10man-lobby
├── Lobby
├── Team 1
└── Team 2
```

The channels inherit normal guild/category permissions. You may adjust category overwrites, but preserve the bot's required view, messaging, connection, and member-movement permissions.

### Option B: Configure existing channels in the owner panel

Create one text channel and three voice channels manually, then open the guild in `/admin` and select:

- Lobby text channel.
- Lobby voice channel.
- Team 1 voice channel.
- Team 2 voice channel.
- One or more privileged roles.
- One or more moderator roles.
- One or more administrator roles.
- DatHost template server ID.
- DatHost location.
- Default enabled game profile.

The first web-panel save intentionally creates the configuration disabled. Select **Enable** afterward so the bot validates the saved configuration before allowing new matches.

Managed setup, recovery, and teardown remain Discord-only operations.

## 16. Run diagnostics

Run diagnostics from either location:

- Select **Run diagnostics** on the guild page in `/admin`.
- Run `/match admin diagnostics` in Discord.

Confirm that these checks pass:

- All configured channels exist and have the correct types.
- All configured roles exist.
- The bot has the required permissions in each channel.
- The protected DatHost template is reachable.
- Managed-resource state is consistent.
- No unexpected active-match condition is present.

View the basic saved status with:

```text
/match admin status
```

Do not stage the first real match until diagnostics pass.

## 17. Link participant Steam accounts

Each participant runs:

```text
/steam register
```

The bot returns a private Steam OpenID link. The participant signs in through Steam and returns to the public HTTPS domain to complete verification.

Confirm the link with:

```text
/steam status
```

## 18. Create the first test 10man

A Steam-linked member runs:

```text
/10man queue
```

Verify that:

1. The persistent queue panel appears in the configured lobby text channel.
2. Ten Steam-linked participants can join the queue.
3. Ready check, captain draft, and map veto progress through signed controls.
4. Voice movement uses the configured lobby and team channels.
5. DatHost provisioning duplicates the protected template into a disposable server.
6. MatchZy loads the generated configuration and reports events.
7. Match completion cleans up credentials, voice state, and the disposable server.
8. The protected template remains unchanged.

Use a staging guild and template before relying on the deployment for production matches.

## 19. Rerunning or updating the installation

To update the repository and redeploy:

```bash
cd /path/to/10manbot
git pull
sudo bash scripts/setup-ubuntu.sh
```

On rerun, the script:

- Reuses the existing `.env` instead of replacing database and cryptographic secrets.
- Restores `.env` mode `600`.
- Reads the domain from `PUBLIC_BASE_URL`.
- Adds panel OAuth settings when upgrading an older `.env` that has no `DISCORD_CLIENT_SECRET`.
- Revalidates and restarts Caddy.
- Rebuilds the application image.
- Starts or preserves PostgreSQL and its volume.
- Applies pending migrations.
- Reseeds profiles.
- Registers the current global slash commands.
- Restarts the application.
- Repeats local and public readiness checks.

When upgrading an old installation, be prepared to enter the Discord OAuth client secret and owner Discord user IDs. Also add the `/admin/auth/callback` redirect in the Discord Developer Portal.

Never delete `.env` or the `postgres-data` Docker volume as part of a routine update. Do not rotate `CREDENTIAL_ENCRYPTION_KEY`, `MATCH_TOKEN_SIGNING_SECRET`, or `PANEL_SESSION_SECRET` without a planned rotation procedure.

## 20. Common problems

### The installer rejects the operating system

Use Ubuntu. The script intentionally stops on other distributions.

### Docker installation fails

Check Ubuntu's codename, outbound HTTPS access, APT repository state, and available disk space. Then rerun the installer.

### The application never becomes locally ready

Run:

```bash
sudo docker compose ps
sudo docker compose logs --tail=200 postgres
sudo docker compose logs --tail=200 app
```

Common causes include invalid environment values, PostgreSQL health failure, migration failure, invalid Discord credentials, or invalid DatHost credentials.

### Public HTTPS verification fails

Confirm:

- The domain resolves to this server.
- External TCP 80 and 443 are open.
- No `AAAA` record points to broken IPv6.
- Caddy is running and its configuration validates.
- Another service is not occupying ports 80 or 443.

Run:

```bash
sudo journalctl -u caddy -n 200 --no-pager
```

### Discord OAuth says the redirect is invalid

The Developer Portal callback must exactly match `PUBLIC_BASE_URL` plus `/admin/auth/callback`.

### Owner login returns Access denied

Confirm that `PANEL_OWNER_DISCORD_USER_IDS` contains the user's numeric Discord user ID, not the application ID, guild ID, role ID, or username. After correcting `.env`, restart the app:

```bash
sudo docker compose up -d --force-recreate app
```

### Slash commands do not appear

Confirm the `applications.commands` invite scope and rerun:

```bash
sudo docker compose run --rm app node dist/register-commands.js
```

### Managed setup was interrupted

Inspect the Discord guild and audit log for a channel that may have been created before its ID was persisted. Remove only the positively identified ambiguous resource, then use:

```text
/match admin recover-setup
```

The bot intentionally does not infer ownership from channel names.

## 21. Operational commands

```bash
# Container status
sudo docker compose ps

# Follow application logs
sudo docker compose logs -f app

# Follow PostgreSQL logs
sudo docker compose logs -f postgres

# Restart only the application
sudo docker compose restart app

# Reapply pending migrations
sudo docker compose --profile tools run --rm db-tools

# Reseed game profiles
sudo docker compose --profile tools run --rm db-tools corepack pnpm prisma:seed

# Register current Discord commands
sudo docker compose run --rm app node dist/register-commands.js

# Check Caddy
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

For production recovery and safety rules, continue with:

- [Operations Runbook](operations.md)
- [Troubleshooting](troubleshooting.md)
- [Discord Setup](discord-setup.md)
- [DatHost Template Setup](dathost-template-setup.md)
- [Permissions Matrix](permissions.md)
- [Staging Acceptance Checklist](staging-checklist.md)
