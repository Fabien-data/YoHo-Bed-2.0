#!/usr/bin/env bash
#
# YoHoBed 2.0 — nightly backup of everything that is not in git.
#
# Three things on this server cannot be rebuilt from the repository:
#   1. the database        (tester data, bookings, accounts)
#   2. production.env      (generated secrets and DB passwords)
#   3. the media directory (uploaded photos)
#
# All three were lost on 2026-07-27 because none of them were backed up anywhere.
#
# Installed at /srv/yohobed/backup.sh, run by cron nightly at 02:15 as root.
#
# Off-box copy: set BACKUP_REMOTE to an scp target in /etc/default/yohobed-backup,
# e.g. BACKUP_REMOTE=backups@elsewhere:/srv/yohobed-backups
# A backup that only exists on the machine it protects does not survive a reinstall.
#
set -euo pipefail

ROOT_DIR=/srv/yohobed
ENV_FILE="$ROOT_DIR/env/production.env"
MEDIA_DIR="$ROOT_DIR/media"
DEST="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

[[ -f /etc/default/yohobed-backup ]] && . /etc/default/yohobed-backup

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
chmod 700 "$DEST"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

# DATABASE_URL is the owner connection; needed to dump every table regardless of RLS.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

log "dumping database"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner \
        --file="$DEST/db-$STAMP.dump"

log "archiving env + media"
tar czf "$DEST/files-$STAMP.tar.gz" \
    -C "$ROOT_DIR" env \
    $([[ -d "$MEDIA_DIR" ]] && echo media)

chmod 600 "$DEST"/db-"$STAMP".dump "$DEST"/files-"$STAMP".tar.gz

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  log "copying off-box -> $BACKUP_REMOTE"
  scp -q -o BatchMode=yes -o ConnectTimeout=20 \
      "$DEST/db-$STAMP.dump" "$DEST/files-$STAMP.tar.gz" "$BACKUP_REMOTE/" \
    && log "off-box copy ok" \
    || log "WARNING off-box copy FAILED — local copy retained"
else
  log "WARNING BACKUP_REMOTE unset — backups exist only on this server"
fi

log "pruning older than ${RETAIN_DAYS}d"
find "$DEST" -type f -name 'db-*.dump'      -mtime +"$RETAIN_DAYS" -delete
find "$DEST" -type f -name 'files-*.tar.gz' -mtime +"$RETAIN_DAYS" -delete

log "done: $(du -sh "$DEST" | cut -f1) in $DEST"

# Restore, for when it matters and nobody remembers the flags:
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" db-STAMP.dump
#   tar xzf files-STAMP.tar.gz -C /srv/yohobed
