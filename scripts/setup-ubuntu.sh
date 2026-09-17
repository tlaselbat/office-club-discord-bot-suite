#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
CADDY_DIR="/etc/caddy/Caddyfile.d"
CADDY_SITE="${CADDY_DIR}/10manbot.caddy"

log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || die "Run this installer with sudo: sudo bash scripts/setup-ubuntu.sh"
[[ -f "${PROJECT_DIR}/compose.yaml" && -f "${PROJECT_DIR}/Dockerfile" ]] || die "Run the script from this repository checkout."
[[ -r /etc/os-release ]] || die "Cannot identify the operating system."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "This installer supports Ubuntu only."

export DEBIAN_FRONTEND=noninteractive

install_base_packages() {
  log "Installing base packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg openssl
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Engine and Compose are already installed"
    return
  fi
  log "Installing Docker Engine from Docker's official Ubuntu repository"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "${VERSION_CODENAME}" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    log "Caddy is already installed"
    return
  fi
  log "Installing Caddy from Caddy's official repository"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

prompt_value() {
  local variable="$1" prompt="$2" secret="${3:-false}" value
  while true; do
    if [[ "${secret}" == "true" ]]; then
      read -r -s -p "${prompt}: " value
      printf '\n'
    else
      read -r -p "${prompt}: " value
    fi
    [[ -n "${value}" ]] && [[ "${value}" != *$'\n'* ]] && { printf -v "${variable}" '%s' "${value}"; return; }
    printf 'A non-empty single-line value is required.\n' >&2
  done
}

validate_domain() {
  [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || die "Invalid domain name: $1"
}

validate_discord_id() {
  [[ "$1" =~ ^[0-9]{17,20}$ ]] || die "Discord application ID must contain 17-20 digits."
}

dotenv_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\$\$}"
  printf '"%s"' "${value}"
}

write_environment() {
  if [[ -f "${ENV_FILE}" ]]; then
    log "Reusing existing ${ENV_FILE} to preserve database and cryptographic secrets"
    chmod 600 "${ENV_FILE}"
    DOMAIN="$(sed -n 's/^PUBLIC_BASE_URL=https:\/\///p' "${ENV_FILE}" | tail -n 1 | tr -d '"')"
    [[ -n "${DOMAIN}" ]] || die "Existing .env has no usable PUBLIC_BASE_URL."
    validate_domain "${DOMAIN}"
    if ! grep -q '^DISCORD_CLIENT_SECRET=' "${ENV_FILE}"; then
      prompt_value DISCORD_CLIENT_SECRET "Discord OAuth client secret" true
      prompt_value PANEL_OWNER_DISCORD_USER_IDS "Comma-separated owner Discord user IDs"
      local panel_session_secret
      panel_session_secret="$(openssl rand -base64 48 | tr -d '\n')"
      {
        printf 'DISCORD_CLIENT_SECRET=%s\n' "$(dotenv_quote "${DISCORD_CLIENT_SECRET}")"
        printf 'PANEL_OWNER_DISCORD_USER_IDS=%s\n' "$(dotenv_quote "${PANEL_OWNER_DISCORD_USER_IDS}")"
        printf 'PANEL_SESSION_SECRET=%s\n' "$(dotenv_quote "${panel_session_secret}")"
      } >> "${ENV_FILE}"
    fi
    return
  fi

  prompt_value DOMAIN "DNS-ready domain for this bot (for example, 10man.example.com)"
  validate_domain "${DOMAIN}"
  prompt_value DISCORD_TOKEN "Discord bot token" true
  prompt_value DISCORD_CLIENT_ID "Discord application ID"
  validate_discord_id "${DISCORD_CLIENT_ID}"
  prompt_value DISCORD_CLIENT_SECRET "Discord OAuth client secret" true
  prompt_value PANEL_OWNER_DISCORD_USER_IDS "Comma-separated owner Discord user IDs"
  prompt_value DATHOST_EMAIL "DatHost account email"
  [[ "${DATHOST_EMAIL}" == *@*.* ]] || die "DatHost email does not look valid."
  prompt_value DATHOST_PASSWORD "DatHost account password" true
  prompt_value DATHOST_TEMPLATE_SERVER_ID "DatHost template server ID"

  local postgres_password signing_secret panel_session_secret encryption_key
  postgres_password="$(openssl rand -hex 24)"
  signing_secret="$(openssl rand -base64 48 | tr -d '\n')"
  panel_session_secret="$(openssl rand -base64 48 | tr -d '\n')"
  encryption_key="$(openssl rand -base64 32 | tr -d '\n')"

  umask 077
  {
    printf 'NODE_ENV=production\n'
    printf 'HOST=0.0.0.0\n'
    printf 'PORT=3000\n'
    printf 'LOG_LEVEL=info\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$(dotenv_quote "${postgres_password}")"
    printf 'DATABASE_URL=%s\n' "$(dotenv_quote "postgresql://postgres:${postgres_password}@postgres:5432/tenman")"
    printf 'DISCORD_TOKEN=%s\n' "$(dotenv_quote "${DISCORD_TOKEN}")"
    printf 'DISCORD_CLIENT_ID=%s\n' "$(dotenv_quote "${DISCORD_CLIENT_ID}")"
    printf 'DISCORD_CLIENT_SECRET=%s\n' "$(dotenv_quote "${DISCORD_CLIENT_SECRET}")"
    printf 'PANEL_OWNER_DISCORD_USER_IDS=%s\n' "$(dotenv_quote "${PANEL_OWNER_DISCORD_USER_IDS}")"
    printf 'PANEL_SESSION_SECRET=%s\n' "$(dotenv_quote "${panel_session_secret}")"
    printf 'DATHOST_EMAIL=%s\n' "$(dotenv_quote "${DATHOST_EMAIL}")"
    printf 'DATHOST_PASSWORD=%s\n' "$(dotenv_quote "${DATHOST_PASSWORD}")"
    printf 'DATHOST_TEMPLATE_SERVER_ID=%s\n' "$(dotenv_quote "${DATHOST_TEMPLATE_SERVER_ID}")"
    printf 'PUBLIC_BASE_URL=%s\n' "$(dotenv_quote "https://${DOMAIN}")"
    printf 'MATCH_TOKEN_SIGNING_SECRET=%s\n' "$(dotenv_quote "${signing_secret}")"
    printf 'CREDENTIAL_ENCRYPTION_KEY=%s\n' "$(dotenv_quote "${encryption_key}")"
    printf 'DEFAULT_DATHOST_LOCATION=\n'
    printf 'WORKER_POLL_INTERVAL_MS=1000\n'
    printf 'MATCHZY_RECONCILIATION_INTERVAL_MS=30000\n'
    printf 'MATCHZY_STALE_AFTER_MS=120000\n'
  } > "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
}

configure_caddy() {
  log "Configuring Caddy for https://${DOMAIN}"
  install -d -m 0755 "${CADDY_DIR}"
  cat > "${CADDY_SITE}" <<EOF
${DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
  if ! grep -Eq '^[[:space:]]*import[[:space:]]+Caddyfile\.d/\*[[:space:]]*$' /etc/caddy/Caddyfile; then
    printf '\nimport Caddyfile.d/*\n' >> /etc/caddy/Caddyfile
  fi
  caddy fmt --overwrite /etc/caddy/Caddyfile
  caddy fmt --overwrite "${CADDY_SITE}"
  caddy validate --config /etc/caddy/Caddyfile
  systemctl enable caddy
  systemctl restart caddy
}

configure_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
    log "Allowing SSH and HTTPS through the active UFW firewall"
    ufw allow OpenSSH
    ufw allow 80/tcp
    ufw allow 443/tcp
  fi
}

install_systemd_service() {
  log "Installing 10manbot systemd service for automatic startup and failure recovery"
  cat > /etc/systemd/system/10manbot.service <<EOF
[Unit]
Description=10Man Discord bot and HTTP backend
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=0
WorkingDirectory=${PROJECT_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable 10manbot
}

deploy_bot() {
  log "Building application containers"
  cd "${PROJECT_DIR}"
  docker compose build --pull

  log "Starting PostgreSQL"
  docker compose up -d postgres

  log "Applying database migrations"
  docker compose run --rm app pnpm prisma:migrate:deploy

  log "Seeding game profiles"
  docker compose run --rm app pnpm prisma:seed

  log "Registering Discord slash commands"
  docker compose run --rm app node dist/register-commands.js

  log "Installing and starting persistent 10manbot systemd service"
  install_systemd_service
  systemctl restart 10manbot
}

verify_deployment() {
  log "Waiting for local readiness"
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; then
      break
    fi
    if [[ "${attempt}" -eq 60 ]]; then
      docker compose -f "${PROJECT_DIR}/compose.yaml" logs --tail=100 app >&2 || true
      die "The bot did not become ready. Review the logs above."
    fi
    sleep 2
  done

  log "Waiting for public HTTPS readiness"
  for attempt in $(seq 1 30); do
    if curl -fsS "https://${DOMAIN}/health/ready" >/dev/null; then
      printf '\n10Man bot deployment is ready at https://%s\n' "${DOMAIN}"
      printf 'Next: run /match admin setup in Discord.\n'
      return
    fi
    sleep 2
  done
  journalctl -u caddy --no-pager -n 50 >&2 || true
  die "Local service is ready, but public HTTPS verification failed. Check DNS, ports 80/443, and Caddy logs."
}

install_base_packages
install_docker
install_caddy
write_environment
configure_caddy
configure_firewall
deploy_bot
verify_deployment
