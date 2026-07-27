#!/usr/bin/env bash
#
# YoHoBed 2.0 — deploy the current origin/main onto this server.
#
# Installed by infra/provision.sh at /srv/yohobed/deploy.sh, runs as the `yoho`
# user. Pull -> install -> build -> migrate -> reload. It never seeds: db:seed and
# scripts/demo-data.mjs are destructive and would wipe whatever testers have entered.
#
#   /srv/yohobed/deploy.sh              # deploy origin/main
#   REF=some-branch /srv/yohobed/deploy.sh
#
set -euo pipefail

ROOT_DIR=/srv/yohobed
APP_DIR="$ROOT_DIR/app"
ENV_FILE="$ROOT_DIR/env/production.env"
REF="${REF:-origin/main}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE"
[[ -d "$APP_DIR/.git" ]] || die "no checkout at $APP_DIR"

# Sourcing this BEFORE the build is not optional. Next.js inlines NEXT_PUBLIC_API_URL
# into the client bundle at build time; without it, lib/api.ts bakes in its
# http://localhost:3001 fallback and every browser request fails in production
# while curl against the API still looks healthy. This bit us on 2026-07-27.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

cd "$APP_DIR"

log "Fetching $REF"
git fetch --prune origin
git reset --hard "$REF"
git --no-pager log --oneline -1

log "Installing dependencies"
pnpm install --frozen-lockfile

log "Building"
pnpm build

log "Verifying the web bundle points at the right API"
# Cheap guard against the build-time env trap above.
if grep -rqs "localhost:3001" apps/web-extranet/.next/static; then
  die "web bundle contains localhost:3001 — env was not sourced before build"
fi
echo "ok — no localhost:3001 in the bundle"

log "Migrating the database"
pnpm --filter @yohobed/db db:migrate

log "Reloading processes"
# startOrReload handles both the first boot and every subsequent deploy, and reads
# the process definitions from one file instead of assembling pm2 arguments here.
# Hand-built `pm2 start ... --name X -- args` invocations put --name after the --,
# which silently produced a nameless process on 2026-07-27.
pm2 startOrReload "$ROOT_DIR/ecosystem.config.cjs" --update-env

pm2 save
pm2 list

log "Health check"
for i in $(seq 1 20); do
  if curl -fsS -m 5 http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "api healthy"; break
  fi
  [[ $i -eq 20 ]] && die "api did not become healthy"
  sleep 3
done
curl -fsS -m 10 -o /dev/null -w 'web http %{http_code}\n' http://127.0.0.1:3000/ || true

log "Deployed $(git rev-parse --short HEAD)"
