#!/usr/bin/env bash
# DeepRead — Import an external SQLite database into production
# This REPLACES the production database with the provided file.
# The application MUST be stopped before running this script.
# Usage: sudo ./deploy/import-db.sh /path/to/source.db

set -euo pipefail

PM2_STOPPED=false
DB_PATH="/data/deepread/app.db"
IMPORT_FILE="${1:-}"

cleanup() {
  if [ "$PM2_STOPPED" = true ]; then
    echo "[INFO] Import failed or interrupted. Restarting DeepRead..."
    pm2 restart deepread || true
  fi
}

trap cleanup EXIT


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


# ----- Stop application -----
if pm2 list 2>/dev/null | grep -q "deepread"; then
  echo "[INFO] Stopping DeepRead..."
  pm2 stop deepread
  PM2_STOPPED=true
fi


# ----- STEP 1: Validate SQLite database -----
echo "[1/6] Validating source database..."


SQLITE_HEADER=$(head -c 16 "$IMPORT_FILE" 2>/dev/null || true)

if [[ "$SQLITE_HEADER" != SQLite\ format\ 3* ]]; then
  echo "[ERROR] Source file is NOT a valid SQLite database."
  echo "        First 16 bytes:"
  echo "$SQLITE_HEADER" | xxd | head -1
  exit 1
fi


TABLE_COUNT=$(sqlite3 "$IMPORT_FILE" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" \
  2>/dev/null || echo "FAIL")


if [ "$TABLE_COUNT" = "FAIL" ]; then
  echo "[ERROR] Cannot read source database."
  exit 1
fi


REQUIRED_TABLES=(
  "articles"
  "article_blocks"
  "vocabulary"
)


MISSING=()

for TABLE in "${REQUIRED_TABLES[@]}"; do
  EXISTS=$(sqlite3 "$IMPORT_FILE" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$TABLE';" \
    2>/dev/null || echo "0")

  if [ "$EXISTS" = "0" ]; then
    MISSING+=("$TABLE")
  fi
done


if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[WARN] Missing expected tables:"
  for TABLE in "${MISSING[@]}"; do
    echo "       - $TABLE"
  done
  echo ""
fi


ARTICLE_COUNT=$(sqlite3 "$IMPORT_FILE" \
  "SELECT COUNT(*) FROM articles;" \
  2>/dev/null || echo "?")

echo "    Valid SQLite."
echo "    Tables: ${TABLE_COUNT}"
echo "    Articles: ${ARTICLE_COUNT}"


# ----- STEP 2: Backup production database -----
echo ""
echo "[2/6] Backing up current production database..."


SAFETY_BACKUP=""

if [ -f "$DB_PATH" ]; then

  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

  SAFETY_BACKUP="/data/deepread/backups/pre-import-${STAMP}.db"

  mkdir -p "$(dirname "$SAFETY_BACKUP")"

  cp "$DB_PATH" "$SAFETY_BACKUP"

  echo "    Backup:"
  echo "    $SAFETY_BACKUP"

else

  echo "    No existing database."

fi



# ----- STEP 3: Confirmation -----
echo ""
echo "[3/6] Confirmation"
echo ""

echo "    This will replace:"
echo "    $DB_PATH"

echo ""

echo "    With:"
echo "    $IMPORT_FILE"

echo ""

read -rp "    Type 'IMPORT' to proceed: " CONFIRM


if [ "$CONFIRM" != "IMPORT" ]; then

  echo "    Aborted."

  exit 0

fi



# ----- STEP 4: Replace database -----
echo ""
echo "[4/6] Copying database..."


mkdir -p "$(dirname "$DB_PATH")"

cp "$IMPORT_FILE" "$DB_PATH"


echo "    Done:"
echo "    $DB_PATH"



# ----- STEP 5: Remove SQLite WAL files -----
echo ""
echo "[5/6] Cleaning WAL/SHM files..."


for SIDECAR in \
  "${DB_PATH}-wal" \
  "${DB_PATH}-shm"
do

  if [ -f "$SIDECAR" ]; then

    rm -f "$SIDECAR"

    echo "    Removed:"
    echo "    $(basename "$SIDECAR")"

  fi

done


echo "    Done."



# ----- STEP 6: Verify database -----
echo ""
echo "[6/6] Verifying database..."


VERIFY_COUNT=$(sqlite3 "$DB_PATH" \
  "SELECT COUNT(*) FROM articles;" \
  2>/dev/null || echo "FAIL")


if [ "$VERIFY_COUNT" = "FAIL" ]; then

  echo "[ERROR] Imported database verification failed."

  exit 1

fi


echo "    Database readable."
echo "    Articles: $VERIFY_COUNT"



# ----- Restart application -----
echo ""
echo "    Restarting DeepRead..."


pm2 restart deepread

PM2_STOPPED=false


sleep 3



# ----- Health check -----
echo ""
echo "    Health check..."


if curl -sf http://127.0.0.1:3000/api/health > /dev/null 2>&1; then

  echo "    [OK] Application responding."

else

  echo "    [WARN] Health check failed."
  echo "    Run:"
  echo "    pm2 logs deepread"

fi



echo ""
echo "==> Import complete."

if [ -n "$SAFETY_BACKUP" ]; then
  echo "    Previous database:"
  echo "    $SAFETY_BACKUP"
fi

echo ""
echo "    Verify your website."