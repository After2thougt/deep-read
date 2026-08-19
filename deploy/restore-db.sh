#!/usr/bin/env bash
# DeepRead — Production database restore
# Usage: ./deploy/restore-db.sh /path/to/backup.db
# The application MUST be stopped before running this script.
set -euo pipefail

APP_DIR="/opt/deepread/app"
DB_PATH="${DATABASE_PATH:-/data/deepread/app.db}"
BACKUP_INPUT="${1:-}"

if [ -z "$BACKUP_INPUT" ]; then
  echo "Usage: $0 /path/to/backup.db"
  echo ""
  echo "Available backups:"
  find /data/deepread/backups -name 'app-*.db' -type f | sort -r | head -20
  exit 1
fi

if [ ! -f "$BACKUP_INPUT" ]; then
  echo "[ERROR] Backup file not found: $BACKUP_INPUT"
  exit 1
fi

echo "==> DeepRead database restore"
echo "    Source:      $BACKUP_INPUT"
echo "    Destination: $DB_PATH"
echo ""

# Verify PM2 is stopped
if pm2 list 2>/dev/null | grep -q deepread; then
  echo "[ERROR] DeepRead PM2 process is still running."
  echo "        Stop it first: pm2 stop deepread"
  exit 1
fi

# Verify destination exists (should not restore to nothing)
if [ ! -f "$DB_PATH" ]; then
  echo "[WARN] Production database does not exist at $DB_PATH"
  echo "       This is expected only for first-time recovery."
fi

echo "[WARN] This will REPLACE the production database."
echo ""
read -rp "Type 'yes' to confirm: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Pre-restore safety backup of current database
if [ -f "$DB_PATH" ]; then
  PRE_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  SAFETY_BACKUP="/data/deepread/backups/pre-restore-${PRE_STAMP}.db"
  mkdir -p "$(dirname "$SAFETY_BACKUP")"
  cp "$DB_PATH" "$SAFETY_BACKUP"
  echo "[OK] Pre-restore safety backup: $SAFETY_BACKUP"
fi

# Copy the backup over the production database
cp "$BACKUP_INPUT" "$DB_PATH"
echo "[OK] Database restored from: $BACKUP_INPUT"

# Remove stale WAL/SHM files — SQLite will recreate on next start
for SIDECAR in "${DB_PATH}-wal" "${DB_PATH}-shm"; do
  if [ -f "$SIDECAR" ]; then
    rm -f "$SIDECAR"
    echo "[OK] Removed stale sidecar: $(basename "$SIDECAR")"
  fi
done

echo ""
echo "==> Database restored successfully."
echo "    To complete the restore, restart the application:"
echo "      pm2 start deepread"
echo "    Then verify:"
echo "      curl http://127.0.0.1:3000/api/health"