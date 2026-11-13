#!/usr/bin/env bash
# DeepRead Production Update
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/update.sh [branch]
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
ADMIN_DB_PATH="${DATA_DIR}/app.db"
GUEST_DB_PATH="${DATA_DIR}/guest.db"
ENV_FILE="${APP_DIR}/.env"
PM2_NAME="deepread"
BRANCH="${1:-main}"
HEALTH_ENDPOINT="http://127.0.0.1:3000/api/health"

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
echo "  DeepRead Update: $BRANCH"
echo "============================================================"

cd "$APP_DIR"

if [ ! -d "$DATA_DIR" ] || [ ! -w "$DATA_DIR" ]; then
  error "Database directory is missing or not writable: $DATA_DIR"
fi
[ -f "$ENV_FILE" ] || error "Production environment file is missing: $ENV_FILE"
[ -f "$ADMIN_DB_PATH" ] || error "Admin database not found: $ADMIN_DB_PATH"
[ "$ADMIN_DB_PATH" != "$GUEST_DB_PATH" ] || error "Admin and Guest databases must use different paths"

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

env_key_count() {
  grep -c "^$1=" "$ENV_FILE" || true
}

[ "$(env_key_count DATABASE_PATH)" = "1" ] || error "Set DATABASE_PATH exactly once in $ENV_FILE"
[ "$(env_key_count GUEST_DATABASE_PATH)" = "1" ] || error "Set GUEST_DATABASE_PATH exactly once in $ENV_FILE"
[ "$(env_value DATABASE_PATH)" = "$ADMIN_DB_PATH" ] || error "DATABASE_PATH must be $ADMIN_DB_PATH"
[ "$(env_value GUEST_DATABASE_PATH)" = "$GUEST_DB_PATH" ] || error "GUEST_DATABASE_PATH must be $GUEST_DB_PATH"

# ============================================================
# STEP 1: GIT PULL (verify clean working tree)
# ============================================================
step "1/7 Git pull"

info "Fetching origin..."
git fetch origin

info "Checking working tree..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  error "Working tree has uncommitted changes. Commit or stash first."
fi

info "Pulling $BRANCH (fast-forward only)..."
git pull --ff-only origin "$BRANCH"

CURRENT_COMMIT=$(git rev-parse --short HEAD)
info "Updated to: $CURRENT_COMMIT"

# ============================================================
# STEP 2: DEPENDENCIES
# ============================================================
step "2/7 Installing dependencies"

info "Root npm ci..."
npm ci

if [ -f backend/package.json ]; then
  info "Backend npm ci..."
  (cd backend && npm ci)
fi

# ============================================================
# STEP 3: DATABASE BACKUP AND MIGRATIONS
# ============================================================
step "3/7 Backing up Admin database"
bash "${APP_DIR}/deploy/backup-db.sh" || error "Admin database backup failed; migrations and restart were stopped."

step "4/7 Running Admin database migrations"
[ -f "${APP_DIR}/deploy/migrate.sh" ] || error "Required migration script is missing: ${APP_DIR}/deploy/migrate.sh"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  info "Stopping application before schema migration"
  pm2 stop "$PM2_NAME"
fi
bash "${APP_DIR}/deploy/migrate.sh" || error "Admin database migration failed; build and restart were stopped."

ADMINISTRATOR_COUNT=$(sqlite3 -batch -noheader "$ADMIN_DB_PATH" \
  "SELECT COUNT(*) FROM auth_users WHERE role = 'administrator' AND is_active = 1;") \
  || error "Unable to inspect active Administrator accounts"
[[ "$ADMINISTRATOR_COUNT" =~ ^[0-9]+$ ]] || error "Invalid active Administrator count returned by SQLite"
if [ "$ADMINISTRATOR_COUNT" -eq 0 ]; then
  warn "No active Administrator account exists. Update will not create one."
  warn "After this update, initialize one explicitly with: DATABASE_PATH=$ADMIN_DB_PATH GUEST_DATABASE_PATH=$GUEST_DB_PATH npm --prefix backend run db:bootstrap-administrator"
else
  info "Active Administrator account verified; update will not change its credentials"
fi

# ============================================================
# STEP 4: FRONTEND BUILD
# ============================================================
step "5/7 Building frontend"

npm run build
[ -f dist/index.html ] || error "Frontend build failed: dist/index.html missing"
ASSET_COUNT=$(find dist/assets -type f 2>/dev/null | wc -l)
info "Build complete: $ASSET_COUNT assets"

# ============================================================
# STEP 5: PM2 RESTART (with env update)
# ============================================================
step "6/7 Restarting PM2 with updated env"

pm2 restart "$PM2_NAME" --update-env
sleep 3

# ============================================================
# STEP 6: HEALTH CHECKS
# ============================================================
step "7/7 Health checks"

# PM2 status
if pm2 show "$PM2_NAME" 2>/dev/null | grep -q "online"; then
  info "PM2 process: ONLINE"
else
  error "PM2 process not online. Check: pm2 logs $PM2_NAME"
fi

# Health API
if curl -sf "$HEALTH_ENDPOINT" >/dev/null; then
  HEALTH=$(curl -s "$HEALTH_ENDPOINT")
  info "Health API: $HEALTH"
else
  error "Health API failed. Check: pm2 logs $PM2_NAME"
fi

# Frontend
if curl -sf http://127.0.0.1:3000/ | grep -q '<!doctype html>'; then
  info "Frontend: OK"
else
  error "Frontend not served correctly"
fi

# Test proxy connectivity from PM2 process perspective
# Test Mihomo proxy connectivity
PROXY_STATUS=$(curl -sS \
  -x http://127.0.0.1:7890 \
  -o /dev/null \
  -w '%{http_code}' \
  https://www.bbc.com/ \
  --max-time 10 || true)

if [[ "$PROXY_STATUS" =~ ^[2-5][0-9][0-9]$ ]]; then
  info "Mihomo proxy connectivity: OK (HTTP $PROXY_STATUS)"
else
  warn "Mihomo proxy test failed (HTTP $PROXY_STATUS)"
fi

echo ""
echo "============================================================"
info "UPDATE COMPLETE: $CURRENT_COMMIT"
echo "============================================================"
pm2 status
