#!/usr/bin/env bash
# DeepRead — DANGEROUS: Completely reset the production database
# This DELETES all data permanently.  Use with extreme caution.
# Usage: ./deploy/reset-db.sh
set -euo pipefail

APP_DIR="/opt/deepread/app"
DB_PATH="${DATABASE_PATH:-/data/deepread/app.db}"
BACKUP_ROOT="/data/deepread/backups"

echo "============================================================"
echo "  DANGER: RESET PRODUCTION DATABASE"
echo "============================================================"
echo ""
echo "  This will PERMANENTLY DELETE:"
echo "    $DB_PATH"
echo "    ${DB_PATH}-wal  (if exists)"
echo "    ${DB_PATH}-shm  (if exists)"
echo ""
echo "  ALL articles, vocabulary, highlights, tags, analysis"
echo "  cache, and translations will be LOST FOREVER."
echo ""
echo "  A safety backup will be created before deletion."
echo "============================================================"
echo ""

# Verify PM2 is stopped
if pm2 list 2>/dev/null | grep -q "deepread"; then
  echo "[WARN] DeepRead is running. Database will be re-created on next start."
fi

if [ ! -f "$DB_PATH" ]; then
  echo "[INFO] Production database does not exist — nothing to reset."
  exit 0
fi

echo "Type the current date (YYYY-MM-DD) to confirm:"
read -rp "> " DATE_CONFIRM

TODAY="$(date +%Y-%m-%d)"
if [ "$DATE_CONFIRM" != "$TODAY" ]; then
  echo "Date mismatch (expected: $TODAY). Aborted."
  exit 0
fi

echo ""
echo "One final confirmation. Type 'DELETE ALL DATA' to proceed:"
read -rp "> " FINAL_CONFIRM

if [ "$FINAL_CONFIRM" != "DELETE ALL DATA" ]; then
  echo "Aborted."
  exit 0
fi

# Safety backup
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SAFETY_BACKUP="${BACKUP_ROOT}/pre-reset-${STAMP}.db"
mkdir -p "$(dirname "$SAFETY_BACKUP")"
cp "$DB_PATH" "$SAFETY_BACKUP"
echo "[OK] Safety backup: $SAFETY_BACKUP"

# Delete
rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"
echo "[OK] Database deleted."

echo ""
echo "============================================================"
echo "  Database reset complete."
echo "  Safety backup preserved at: $SAFETY_BACKUP"
echo "  Restart the application to re-create an empty database:"
echo "    pm2 start deepread"
echo "============================================================"