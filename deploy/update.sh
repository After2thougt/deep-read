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
# STEP 3: DATABASE MIGRATIONS
# ============================================================
step "3/7 Running database migrations"
if [ -f "${APP_DIR}/deploy/migrate.sh" ]; then
  bash "${APP_DIR}/deploy/migrate.sh"
else
  warn "No migrate.sh found, skipping migrations"
fi

# ============================================================
# STEP 4: FRONTEND BUILD
# ============================================================
step "4/7 Building frontend"

npm run build
[ -f dist/index.html ] || error "Frontend build failed: dist/index.html missing"
ASSET_COUNT=$(find dist/assets -type f 2>/dev/null | wc -l)
info "Build complete: $ASSET_COUNT assets"

# ============================================================
# STEP 5: RESTART MIHOMO PROXY
# ============================================================
step "5/7 Restarting Mihomo proxy"

if systemctl is-active --quiet mihomo; then
  info "Restarting Mihomo service..."
  sudo systemctl restart mihomo
  sleep 2
  if systemctl is-active --quiet mihomo; then
    info "Mihomo service: ACTIVE"
  else
    warn "Mihomo service failed to restart. Check: systemctl status mihomo"
  fi
else
  warn "Mihomo service not installed/active. Install with: bash deploy/install.sh"
fi

# ============================================================
# STEP 6: PM2 RELOAD (zero-downtime with env update)
# ============================================================
step "6/7 Reloading PM2 with updated env"

pm2 reload "$PM2_NAME" --update-env
sleep 3

# ============================================================
# STEP 7: HEALTH CHECKS
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

# Test proxy connectivity
if curl -sf -x http://127.0.0.1:7890 -I https://ichef.bbci.co.uk/news/ -o /dev/null --max-time 10; then
  info "Mihomo proxy connectivity: OK"
else
  warn "Mihomo proxy test failed (may need proxy configuration in config.yaml)"
fi

echo ""
echo "============================================================"
info "UPDATE COMPLETE: $CURRENT_COMMIT"
echo "============================================================"
pm2 status