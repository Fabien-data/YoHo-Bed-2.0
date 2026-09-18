#!/usr/bin/env bash
#
# YoHoBed 2.0 — one-shot server provisioning, bare Ubuntu 24.04 -> running stack.
#
# Written after the 2026-07-27 incident, when the VPS was reinstalled from the OVH
# panel and the entire hand-built server was lost. Everything the old box had was
# assembled ad-hoc over SSH and existed nowhere else; this script is that build,
# captured so a wipe costs twenty minutes instead of a day.
#
# Idempotent: safe to re-run. Each step checks before it acts.
#
# Usage (as root on a fresh box):
#   DOMAIN=yova.markui.lk LETSENCRYPT_EMAIL=<your-email> ./provision.sh
#
# Afterwards the repo still needs a GitHub deploy key (see infra/README.md), then:
#   /srv/yohobed/deploy.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:-yova.markui.lk}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
GITHUB_ORG="${GITHUB_ORG:-Fabien-data}"
GITHUB_REPO="${GITHUB_REPO:-YoHo-Bed-2.0}"
# Assembled rather than written literally: an SSH clone URL is indistinguishable from
# an email address to most redaction filters, and one mangled it into a broken
# ${VAR:offset} expansion here on 2026-07-27.
REPO_URL="${REPO_URL:-git@github.com:${GITHUB_ORG}/${GITHUB_REPO}.git}"
RUN_USER="${RUN_USER:-yoho}"
ROOT_DIR=/srv/yohobed
APP_DIR="$ROOT_DIR/app"
ENV_DIR="$ROOT_DIR/env"
MEDIA_DIR="$ROOT_DIR/media"
# Payment slips and ID scans: never public, never served from MEDIA_DIR (Phase 02, Sprint 5).
PRIVATE_DIR="$ROOT_DIR/private"
ENV_FILE="$ENV_DIR/production.env"
NODE_MAJOR=22
PG_MAJOR=16

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"

# ---------------------------------------------------------------------------
log "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg git ufw nginx redis-server \
  "postgresql-$PG_MAJOR" postgresql-client-"$PG_MAJOR" \
  certbot python3-certbot-nginx logrotate jq unzip

# ---------------------------------------------------------------------------
log "Swap (2G)"
# 4GB box running a Next.js build needs headroom or the build OOMs.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "swap already present"
fi

# ---------------------------------------------------------------------------
log "Runtime user: $RUN_USER"
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  adduser --system --group --shell /bin/bash --home "/home/$RUN_USER" "$RUN_USER"
fi
mkdir -p "$APP_DIR" "$ENV_DIR" "$MEDIA_DIR" "$PRIVATE_DIR" "/home/$RUN_USER"
chown -R "$RUN_USER:$RUN_USER" "$ROOT_DIR" "/home/$RUN_USER"
chmod 750 "$ENV_DIR"
chmod 700 "$PRIVATE_DIR"

# ---------------------------------------------------------------------------
log "Node $NODE_MAJOR + pnpm"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
corepack enable
# packageManager in package.json pins the exact pnpm version; corepack honours it.
node -v && (pnpm -v 2>/dev/null || true)

# ---------------------------------------------------------------------------
log "PostgreSQL $PG_MAJOR — database and roles"
systemctl enable --now postgresql

# Passwords are generated once and persisted in the env file. Re-runs reuse them,
# otherwise the roles and the connection strings would drift apart.
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  PG_OWNER_PW="$(grep -oP '(?<=postgresql://yoho_owner:)[^@]+' "$ENV_FILE" | head -1 || true)"
  PG_APP_PW="$(grep -oP '(?<=postgresql://yoho_app:)[^@]+' "$ENV_FILE" | head -1 || true)"
fi
PG_OWNER_PW="${PG_OWNER_PW:-$(openssl rand -hex 24)}"
PG_APP_PW="${PG_APP_PW:-$(openssl rand -hex 24)}"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='yoho_owner') THEN
    CREATE ROLE yoho_owner LOGIN PASSWORD '${PG_OWNER_PW}';
  ELSE
    ALTER ROLE yoho_owner PASSWORD '${PG_OWNER_PW}';
  END IF;
  -- Pre-create yoho_app with a strong password. packages/db/src/rls.sql creates it
  -- with the dev password 'yoho_app_pw' if it is missing, so it MUST exist first.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='yoho_app') THEN
    CREATE ROLE yoho_app LOGIN PASSWORD '${PG_APP_PW}';
  ELSE
    ALTER ROLE yoho_app PASSWORD '${PG_APP_PW}';
  END IF;
END \$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='yohobed'" | grep -q 1; then
  sudo -u postgres createdb -O yoho_owner yohobed
fi

# ---------------------------------------------------------------------------
log "Redis"
systemctl enable --now redis-server

# ---------------------------------------------------------------------------
log "Environment file: $ENV_FILE"
# NEXT_PUBLIC_API_URL is inlined into the web bundle at BUILD time. If a build runs
# without this file sourced, lib/api.ts falls back to http://localhost:3001 and every
# browser call fails while curl-to-API still works. deploy.sh always sources it.
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<ENV
# Generated by infra/provision.sh — secrets, keep 640 root:$RUN_USER.
# NODE_ENV=production makes the worker (and Next.js) fail fast on missing config
# instead of silently booting onto dev-port fallbacks.
NODE_ENV=production
DATABASE_URL=postgresql://yoho_owner:${PG_OWNER_PW}@127.0.0.1:5432/yohobed
APP_DATABASE_URL=postgresql://yoho_app:${PG_APP_PW}@127.0.0.1:5432/yohobed
PORT=3001
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=1d
CM_WEBHOOK_SECRET=$(openssl rand -hex 32)
EMAIL_PROVIDER=console
# EMAIL_FROM intentionally omitted: config/env.ts already defaults it, and the value
# contains angle brackets, which break \`source\` unless quoted. Only set it here if
# you switch EMAIL_PROVIDER to resend, and single-quote the whole value if you do.
WEB_URL=https://${DOMAIN}
CORS_ORIGINS=https://${DOMAIN}
MEDIA_DIR=${MEDIA_DIR}
PRIVATE_FILES_DIR=${PRIVATE_DIR}
REDIS_URL=redis://127.0.0.1:6379
CM_PROVIDER=fake
NEXT_PUBLIC_API_URL=https://${DOMAIN}/api
ENV
  echo "created (secrets generated)"
else
  warn "env file exists — its secrets are left untouched"
  # Settings added after the file was first generated; appended once, never overwritten.
  grep -q '^PRIVATE_FILES_DIR=' "$ENV_FILE" || echo "PRIVATE_FILES_DIR=${PRIVATE_DIR}" >> "$ENV_FILE"
fi
chown root:"$RUN_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# ---------------------------------------------------------------------------
log "nginx — single-domain path proxy"
# / -> Next.js :3000, /api/ -> NestJS :3001. The trailing slash on the upstream
# strips the /api prefix, because Nest routes are mounted at the root.
cat > /etc/nginx/sites-available/yohobed <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 25m;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/yohobed /etc/nginx/sites-enabled/yohobed
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---------------------------------------------------------------------------
log "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status verbose | head -8

# ---------------------------------------------------------------------------
log "PM2"
npm install -g pm2 >/dev/null 2>&1 || true
install -d -o "$RUN_USER" -g "$RUN_USER" "/home/$RUN_USER/.pm2"
# systemd unit so all three processes come back after a reboot.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$RUN_USER" --hp "/home/$RUN_USER" >/dev/null
systemctl enable "pm2-$RUN_USER" >/dev/null 2>&1 || true

cat > /etc/logrotate.d/yohobed <<LOGROTATE
/home/$RUN_USER/.pm2/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su $RUN_USER $RUN_USER
}
LOGROTATE

# ---------------------------------------------------------------------------
log "Deploy + backup scripts"
install -m 750 -o "$RUN_USER" -g "$RUN_USER" "$(dirname "$0")/deploy.sh" "$ROOT_DIR/deploy.sh"
install -m 750 -o root       -g root       "$(dirname "$0")/backup.sh" "$ROOT_DIR/backup.sh"
install -m 640 -o "$RUN_USER" -g "$RUN_USER" \
  "$(dirname "$0")/ecosystem.config.cjs" "$ROOT_DIR/ecosystem.config.cjs"

# Nightly database dump, retained 14 days. Off-box copy runs only if a target is set;
# a backup that lives on the machine it protects is not a backup.
cat > /etc/cron.d/yohobed-backup <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * root $ROOT_DIR/backup.sh >> /var/log/yohobed-backup.log 2>&1
CRON

# ---------------------------------------------------------------------------
log "Repository"
if [[ ! -d "$APP_DIR/.git" ]]; then
  warn "no checkout at $APP_DIR"
  warn "add a GitHub deploy key for $RUN_USER, then:"
  warn "  sudo -u $RUN_USER git clone $REPO_URL $APP_DIR"
  warn "  $ROOT_DIR/deploy.sh"
else
  echo "checkout present"
fi

# ---------------------------------------------------------------------------
log "TLS"
if [[ -n "$LETSENCRYPT_EMAIL" ]]; then
  if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
      -m "$LETSENCRYPT_EMAIL" --redirect
  else
    echo "certificate already present"
  fi
  systemctl enable --now certbot.timer
else
  warn "LETSENCRYPT_EMAIL unset — skipping TLS. Run later:"
  warn "  certbot --nginx -d $DOMAIN --redirect -m you@example.com --agree-tos"
fi

log "Provisioning complete"
cat <<SUMMARY

  Domain     https://${DOMAIN}
  App root   ${ROOT_DIR}
  Env file   ${ENV_FILE}   (640 root:${RUN_USER})
  Deploy     ${ROOT_DIR}/deploy.sh
  Backups    nightly 02:15 -> ${ROOT_DIR}/backups (set BACKUP_REMOTE for off-box)

  Database passwords were generated into the env file. They are not printed here
  and not stored anywhere else — back that file up separately from the database.

SUMMARY
