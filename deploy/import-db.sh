#!/usr/bin/env bash
# DeepRead — Import an external SQLite database into production
# This REPLACES the production database with the provided file.
# The application MUST be stopped before running this script.
# Usage: sudo ./deploy/import-db.sh /path/to/source.db
set -euo pipefail

APP_DIR="/opt/deepread/app"
DB_PATH="${DATABASE_PATH:-/data/deepread/app.db}"
IMPORT_FILE="${1:-}"

if [ -z "$IMPORT_FILE" ]; then
  echo "Usage: $0 /path/to/source.db"
  exit 1
fi

if [ ! -f "$IMPORT_FILE" ]; then
  echo "[ERROR] Source database not found: $IMPORT_FILE"
  exit 1
fi

echo "==> DeepRead database import"
echo "    Source:      $IMPORT_FILE"
echo "    Destination: $DB_PATH"
echo ""

# Stop PM2 if running
if pm2 list 2>/dev/null | grep -q "deepread"; then
  echo "[INFO] Stopping DeepRead..."
  pm2 stop deepread
fi

# ----- STEP 1: Validate source SQLite database -----
echo "[1/6] Validating source database..."

# Check if it's a valid SQLite file
SQLITE_HEADER=$(head -c 16 "$IMPORT_FILE" 2>/dev/null || true)
if [ "$SQLITE_HEADER" != "SQLite format 3" ] && [[ ! "$SQLITE_HEADER" =~ ^SQLite\ format\ 3 ]]; then
  echo "[ERROR] Source file is NOT a valid SQLite database."
  echo "        First 16 bytes: $(echo "$SQLITE_HEADER" | xxd | head -1)"
  exit 1
fi

# Check we can open and query it
TABLE_COUNT=$(sqlite3 "$IMPORT_FILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "FAIL")
if [ "$TABLE_COUNT" = "FAIL" ]; then
  echo "[ERROR] Cannot read source database.  Corrupted or encrypted?"
  exit 1
fi

# Check for required tables
REQUIRED_TABLES=("articles" "article_blocks" "vocabulary")
MISSING=()
for TABLE in "${REQUIRED_TABLES[@]}"; do
  EXISTS=$(sqlite3 "$IMPORT_FILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$TABLE';" 2>/dev/null || echo "0")
  if [ "$EXISTS" = "0" ]; then
    MISSING+=("$TABLE")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[WARN] Source database is missing expected tables:"
  for TABLE in "${MISSING[@]}"; do
    echo "       - $TABLE"
  done
  echo "       Import will proceed, but the application may fail if"
  echo "       db.js idempotent CREATE TABLE is insufficient."
fi

ARTICLE_COUNT=$(sqlite3 "$IMPORT_FILE" "SELECT COUNT(*) FROM articles;" 2>/dev/null || echo "?")
echo "    Valid SQLite. ${TABLE_COUNT} tables. ~${ARTICLE_COUNT} articles."

# ----- STEP 2: Backup current production database -----
echo ""
echo "[2/6] Backing up current production database..."
if [ -f "$DB_PATH" ]; then
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  SAFETY_BACKUP="/data/deepread/backups/pre-import-${STAMP}.db"
  mkdir -p "$(dirname "$SAFETY_BACKUP")"
  cp "$DB_PATH" "$SAFETY_BACKUP"
  echo "    Safety backup: $SAFETY_BACKUP"
else
  echo "    No existing database to back up."
fi

# ----- STEP 3: Confirmation -----
echo ""
echo "[3/6] Confirmation"
echo ""
echo "    This will REPLACE the production database with:"
echo "      $IMPORT_FILE"
echo ""
echo "    Current data will be backed up to /data/deepread/backups/."
echo "    This is the ONLY script allowed to intentionally replace the"
echo "    production database."
echo ""
read -rp "    Type 'IMPORT' to proceed: " CONFIRM

if [ "$CONFIRM" != "IMPORT" ]; then
  echo "    Aborted."
  if ! pm2 list 2>/dev/null | grep -q "deepread"; then
    echo "    Restarting DeepRead..."
    pm2 start deepread
  fi
  exit 0
fi

# ----- STEP 4: Copy to production location -----
echo ""
echo "[4/6] Copying database to production location..."
mkdir -p "$(dirname "$DB_PATH")"
cp "$IMPORT_FILE" "$DB_PATH"
echo "    Done: $DB_PATH"

# ----- STEP 5: Remove stale WAL/SHM -----
echo ""
echo "[5/6] Cleaning stale WAL/SHM files..."
for SIDECAR in "${DB_PATH}-wal" "${DB_PATH}-shm"; do
  if [ -f "$SIDECAR" ]; then
    rm -f "$SIDECAR"
    echo "    Removed: $(basename "$SIDECAR")"
  fi
done
echo "    Done."

# ----- STEP 6: Verify -----
echo ""
echo "[6/6] Verifying imported database..."
VERIFY_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM articles;" 2>/dev/null || echo "FAIL")
if [ "$VERIFY_COUNT" = "FAIL" ]; then
  echo "[ERROR] Cannot read imported database — restore from backup immediately!"
  exit 1
fi
echo "    Database readable: ${VERIFY_COUNT} articles"

# Restart
echo ""
echo "    Restarting DeepRead..."
pm2 start deepread
sleep 2

# Health check
echo ""
echo "    Health check..."
if curl -sf http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
  echo "    [OK] Application responding."
else
  echo "    [WARN] Health check failed. Check logs: pm2 logs deepread"
fi

echo ""
echo "==> Import complete."
echo "    Previous database backed up at: $SAFETY_BACKUP (if existed)"
echo "    Verify the application is working at your domain."