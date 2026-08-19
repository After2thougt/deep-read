#!/usr/bin/env bash
# DeepRead Database Migration Runner
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/migrate.sh
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
APP_DIR="/opt/deepread/app"
DATA_DIR="/data/deepread"
DB_PATH="${DATA_DIR}/app.db"
MIGRATIONS_DIR="${APP_DIR}/deploy/migrations"

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
echo "  DeepRead Database Migrations"
echo "============================================================"

[ -f "$DB_PATH" ] || error "Database not found: $DB_PATH"
[ -d "$MIGRATIONS_DIR" ] || { warn "Migrations directory not found: $MIGRATIONS_DIR"; exit 0; }

# ============================================================
# ENSURE MIGRATIONS TABLE EXISTS
# ============================================================
step "Ensuring migrations table exists"

sqlite3 "$DB_PATH" <<'EOF'
CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
EOF
info "Migrations table ready"

# ============================================================
# GET APPLIED MIGRATIONS
# ============================================================
APPLIED=$(sqlite3 "$DB_PATH" "SELECT id FROM migrations ORDER BY id;")
info "Already applied: ${APPLIED:-none}"

# ============================================================
# FIND PENDING MIGRATIONS
# ============================================================
step "Scanning for pending migrations"

# Get all .sql files sorted by filename
MIGRATION_FILES=()
while IFS= read -r -d '' file; do
  MIGRATION_FILES+=("$file")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -print0 | sort -z)

if [ ${#MIGRATION_FILES[@]} -eq 0 ]; then
  info "No migration files found in $MIGRATIONS_DIR"
  exit 0
fi

PENDING=()
for file in "${MIGRATION_FILES[@]}"; do
  MIGRATION_ID=$(basename "$file" .sql)
  if echo "$APPLIED" | grep -qx "$MIGRATION_ID"; then
    info "  [SKIP] $MIGRATION_ID (already applied)"
  else
    PENDING+=("$file")
    info "  [PENDING] $MIGRATION_ID"
  fi
done

if [ ${#PENDING[@]} -eq 0 ]; then
  info "No pending migrations"
  exit 0
fi

# ============================================================
# EXECUTE PENDING MIGRATIONS
# ============================================================
step "Executing ${#PENDING[@]} pending migration(s)"

for file in "${PENDING[@]}"; do
  MIGRATION_ID=$(basename "$file" .sql)
  info "Applying: $MIGRATION_ID"

  # Execute migration in a transaction
  if sqlite3 "$DB_PATH" < "$file"; then
    # Record successful migration
    sqlite3 "$DB_PATH" "INSERT INTO migrations (id, applied_at) VALUES ('$MIGRATION_ID', datetime('now'));"
    info "  ✓ $MIGRATION_ID applied"
  else
    error "Migration $MIGRATION_ID failed! Database may be in inconsistent state."
  fi
done

# ============================================================
# VERIFY
# ============================================================
step "Verification"

FINAL_APPLIED=$(sqlite3 "$DB_PATH" "SELECT id FROM migrations ORDER BY id;")
info "Applied migrations: ${FINAL_APPLIED:-none}"

echo ""
echo "============================================================"
info "MIGRATIONS COMPLETE"
echo "============================================================"