#!/usr/bin/env bash
# DeepRead — Production database backup
# Safe to run while the application is running (uses better-sqlite3 .backup()).
# Usage: ./deploy/backup-db.sh
set -euo pipefail

APP_DIR="/opt/deepread/app"
DB_PATH="${DATABASE_PATH:-/data/deepread/app.db}"
BACKUP_ROOT="/data/deepread/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_ROOT}/app-${STAMP}.db"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

echo "==> DeepRead database backup"

# Verify production database exists
if [ ! -f "$DB_PATH" ]; then
  echo "[ERROR] Database not found at $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_ROOT"

# Use the application's own backup script (better-sqlite3 .backup via Node.js)
cd "$APP_DIR"
if node -e "
  const { db } = require('./backend/db');
  db.backup('$BACKUP_FILE')
    .then(() => { console.log('Backup complete.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
" 2>&1; then
  echo "[OK] Backup created: $BACKUP_FILE"

  # Report sizes
  ORIG_SIZE=$(stat --printf="%s" "$DB_PATH" 2>/dev/null || stat -f%z "$DB_PATH" 2>/dev/null || echo "?")
  BACKUP_SIZE=$(stat --printf="%s" "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo "?")
  echo "     Original: ${ORIG_SIZE} bytes"
  echo "     Backup:   ${BACKUP_SIZE} bytes"

  # Purge old backups (> KEEP_DAYS)
  if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
    echo "     Purging backups older than ${KEEP_DAYS} days..."
    find "$BACKUP_ROOT" -name 'app-*.db' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
    find "$BACKUP_ROOT" -name 'app-*.db' -type f | wc -l | xargs echo "     Remaining backups:"
  fi
else
  echo "[WARN] better-sqlite3 .backup() failed. Falling back to file copy backup."
  echo "       (You should stop the application for file-copy backups to avoid corruption.)"
  cp "$DB_PATH" "$BACKUP_FILE"
  echo "[OK] Copy backup created: $BACKUP_FILE"
fi

echo "==> Done"