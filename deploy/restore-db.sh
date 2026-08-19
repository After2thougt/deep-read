#!/usr/bin/env bash
# DeepRead Database Restore
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/restore-db.sh [backup-file]
set -euo pipefail

# ============================================================
# CONFIGURATION
# ============================================================
DATA_DIR="/data/deepread"
DB_PATH="${DATA_DIR}/app.db"
BACKUP_DIR="${DATA_DIR}/backups"
PM2_NAME="deepread"
BACKUP_FILE="${1:-}"

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
echo "  DeepRead Database Restore"
echo "============================================================"

if [ "$(id -u)" = "0" ]; then
  error "Do NOT run as root. Run as ubuntu user."
fi

# Select backup file
if [ -z "$BACKUP_FILE" ]; then
  step "Select backup to restore"
  mapfile -t BACKUPS < <(ls -t "$BACKUP_DIR"/app-*.db 2>/dev/null)
  [ ${#BACKUPS[@]} -eq 0 ] && error "No backups found in $BACKUP_DIR"

  echo "Available backups:"
  for i in "${!BACKUPS[@]}"; do
    SIZE=$(du -h "${BACKUPS[i]}" | cut -f1)
    echo "  [$((i+1))] ${BACKUPS[i]} ($SIZE)"
  done
  read -rp "Enter number to restore: " IDX
  [[ "$IDX" =~ ^[0-9]+$ ]] && [ "$IDX" -ge 1 ] && [ "$IDX" -le ${#BACKUPS[@]} ] || error "Invalid selection"
  BACKUP_FILE="${BACKUPS[$((IDX-1))]}"
else
  [ -f "$BACKUP_FILE" ] || [ -f "${BACKUP_DIR}/${BACKUP_FILE}" ] || error "Backup file not found: $BACKUP_FILE"
  [ -f "$BACKUP_FILE" ] || BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
fi

warn "============================================================"
warn "  RESTORE WILL OVERWRITE CURRENT DATABASE"
warn "  Source: $BACKUP_FILE"
warn "  Target: $DB_PATH"
warn "============================================================"
read -rp "Type 'yes' to confirm: " CONFIRM
[ "$CONFIRM" = "yes" ] || error "Restore cancelled"

# ============================================================
# RESTORE
# ============================================================
step "1/5 Stopping application"
pm2 stop "$PM2_NAME"
sleep 2

step "2/5 Backing up current database (pre-restore)"
if [ -f "$DB_PATH" ]; then
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  PRE_RESTORE="${BACKUP_DIR}/app-pre-restore-${TS}.db"
  cp "$DB_PATH" "$PRE_RESTORE"
  info "Current database backed up to: $PRE_RESTORE"
fi

step "3/5 Restoring from backup"
cp "$BACKUP_FILE" "$DB_PATH"
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"
info "Database restored from: $BACKUP_FILE"

step "4/5 Verifying restored database"
sqlite3 "$DB_PATH" "PRAGMA integrity_check;" | grep -q "ok" || error "Restored database integrity check failed"
info "Integrity check passed"

step "5/5 Starting application"
pm2 start "$PM2_NAME"
sleep 3

# Health check
info "Running health check..."
if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
  HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
  info "Health API: $HEALTH"
else
  error "Health check failed after restore. Check: pm2 logs $PM2_NAME"
fi

echo ""
echo "============================================================"
info "RESTORE COMPLETE"
echo "============================================================"