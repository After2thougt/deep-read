#!/usr/bin/env bash
# DeepRead Database Import
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/import-db.sh /path/to/source.db
set -euo pipefail

# ============================================================
# ROOT/PM2 SAFETY CHECK
# ============================================================
if [ "$(id -u)" -eq 0 ]; then
  echo "[ERROR] Do NOT run as root. Run as ubuntu user. PM2 must be managed by ubuntu."
  exit 1
fi

# ============================================================
# CONFIGURATION
# ============================================================
SRC_DB="${1:-}"
APP_DIR="/opt/deepread/app"
DATA_DIR="/data/deepread"
DB_PATH="${DATA_DIR}/app.db"
BACKUP_DIR="${DATA_DIR}/backups"
LOG_DIR="${DATA_DIR}/logs"
PM2_NAME="deepread"

# Required tables to verify
REQUIRED_TABLES=("articles" "article_blocks" "vocabulary")

# ============================================================
# COLORS & LOGGING
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()  { echo -e "\n${BLUE}==== $* ====${NC}"; }

# ============================================================
# PRE-FLIGHT
# ============================================================
echo "============================================================"
echo "  DeepRead Database Import"
echo "============================================================"

[ -z "$SRC_DB" ] && error "Usage: bash deploy/import-db.sh /path/to/source.db"
[ -f "$SRC_DB" ] || error "Source database not found: $SRC_DB"

# ============================================================
# STEP 1: VALIDATE SOURCE DATABASE
# ============================================================
step "1/8 Validating source database"

info "Checking SQLite integrity..."
sqlite3 "$SRC_DB" "PRAGMA integrity_check;" | grep -q "ok" || error "Source database integrity check failed"

info "Checking required tables..."
TABLES=$(sqlite3 "$SRC_DB" ".tables")
for table in "${REQUIRED_TABLES[@]}"; do
  echo "$TABLES" | grep -qw "$table" || error "Required table missing: $table"
  info "  ✓ $table"
done

# Count records for info
ARTICLE_COUNT=$(sqlite3 "$SRC_DB" "SELECT COUNT(*) FROM articles;")
VOCAB_COUNT=$(sqlite3 "$SRC_DB" "SELECT COUNT(*) FROM vocabulary;")
info "Source DB stats: articles=$ARTICLE_COUNT, vocabulary=$VOCAB_COUNT"

# ============================================================
# STEP 2: CONFIRMATION
# ============================================================
step "2/8 Confirmation"

warn "This will REPLACE the production database:"
warn "  Target: $DB_PATH"
warn "  Source: $SRC_DB"
warn "  Current data will be backed up, then overwritten."
echo ""
read -rp "Type 'yes' to confirm import: " CONFIRM
[ "$CONFIRM" = "yes" ] || error "Import cancelled by user"

# ============================================================
# STEP 3: STOP PM2
# ============================================================
step "3/8 Stopping application"

pm2 stop "$PM2_NAME"
sleep 2

# ============================================================
# STEP 4: BACKUP CURRENT DATABASE
# ============================================================
step "4/8 Backing up current database"

if [ -f "$DB_PATH" ]; then
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="${BACKUP_DIR}/app-pre-import-${TS}.db"
  # Use SQLite backup for consistency (supports WAL mode)
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
  info "Current database backed up to: $BACKUP_FILE"
else
  warn "No existing database to backup"
fi

# ============================================================
# STEP 5: SAFE DATABASE REPLACEMENT (atomic via mv)
# ============================================================
step "5/8 Importing new database safely"

# Copy to temporary file first
TEMP_DB="${DB_PATH}.new"
cp "$SRC_DB" "$TEMP_DB"
info "Copied source to temporary file: $TEMP_DB"

# Verify integrity of temp file
info "Verifying temporary database integrity..."
sqlite3 "$TEMP_DB" "PRAGMA integrity_check;" | grep -q "ok" || {
  rm -f "$TEMP_DB"
  error "Temporary database integrity check failed. Original database untouched."
}

# Verify required tables exist in temp file
TABLES=$(sqlite3 "$TEMP_DB" ".tables")
for table in "${REQUIRED_TABLES[@]}"; do
  echo "$TABLES" | grep -qw "$table" || {
    rm -f "$TEMP_DB"
    error "Required table missing in temp DB: $table"
  }
done
info "Temporary database validation passed"

# Atomic replace using mv (guarantees original untouched on failure)
mv "$TEMP_DB" "$DB_PATH"
info "Database atomically replaced: $DB_PATH"

# ============================================================
# STEP 6: CLEAN WAL/SHM
# ============================================================
step "6/8 Cleaning WAL/SHM files"

for f in "${DB_PATH}-wal" "${DB_PATH}-shm"; do
  if [ -f "$f" ]; then
    rm -f "$f"
    info "Removed: $f"
  fi
done

# ============================================================
# STEP 7: VERIFY FINAL DATABASE
# ============================================================
step "7/8 Verifying final database"

info "Verifying imported database..."
sqlite3 "$DB_PATH" "PRAGMA integrity_check;" | grep -q "ok" || error "Imported database integrity check failed"

# Verify tables still exist
TABLES=$(sqlite3 "$DB_PATH" ".tables")
for table in "${REQUIRED_TABLES[@]}"; do
  echo "$TABLES" | grep -qw "$table" || error "Required table missing after import: $table"
done

# ============================================================
# STEP 8: RESTART PM2 & HEALTH CHECK
# ============================================================
step "8/8 Restarting application and health check"

info "Starting PM2..."
pm2 start "$PM2_NAME"
sleep 3

# Health check
info "Running health check..."
if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
  HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
  info "Health API: $HEALTH"
else
  error "Health check failed after import. Check: pm2 logs $PM2_NAME"
fi

# Final stats
NEW_ARTICLE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM articles;")
NEW_VOCAB_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM vocabulary;")
info "Import complete ✓"
info "New database stats: articles=$NEW_ARTICLE_COUNT, vocabulary=$NEW_VOCAB_COUNT"

echo ""
echo "============================================================"
info "DATABASE IMPORT SUCCESSFUL"
echo "============================================================"