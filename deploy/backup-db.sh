#!/usr/bin/env bash
# DeepRead Database Backup
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/backup-db.sh
set -euo pipefail

# ============================================================
# ROOT/PM2 SAFETY CHECK
# ============================================================
if [ "$(id -u)" -eq 0 ]; then
  echo "[ERROR] Do NOT run as root. Run as ubuntu user."
  exit 1
fi

# ============================================================
# CONFIGURATION
# ============================================================
DATA_DIR="/data/deepread"
DB_PATH="${DATA_DIR}/app.db"
BACKUP_DIR="${DATA_DIR}/backups"
KEEP_COUNT=30

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
echo "  DeepRead Database Backup"
echo "============================================================"

[ -f "$DB_PATH" ] || error "Database not found: $DB_PATH"

# ============================================================
# BACKUP (SQLite hot backup - supports WAL mode)
# ============================================================
step "Creating backup"

mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
DEST="${BACKUP_DIR}/app-${TS}.db"

info "Backing up (online, non-blocking, WAL-safe)..."
sqlite3 "$DB_PATH" ".backup '$DEST'"

# Verify backup integrity
sqlite3 "$DEST" "PRAGMA integrity_check;" | grep -q "ok" || error "Backup verification failed"

SIZE=$(du -h "$DEST" | cut -f1)
info "Backup created: $DEST ($SIZE)"

# ============================================================
# CLEANUP OLD BACKUPS (keep latest KEEP_COUNT)
# ============================================================
step "Cleaning old backups (keep latest $KEEP_COUNT)"

cd "$BACKUP_DIR"
REMOVED=$(ls -t app-*.db 2>/dev/null | tail -n +$((KEEP_COUNT + 1)) | wc -l)
ls -t app-*.db 2>/dev/null | tail -n +$((KEEP_COUNT + 1)) | xargs -r rm -f
info "Removed $REMOVED old backup(s), keeping latest $KEEP_COUNT"

echo ""
echo "============================================================"
info "BACKUP COMPLETE"
echo "============================================================"
ls -lh "$BACKUP_DIR"/app-*.db 2>/dev/null | head -5