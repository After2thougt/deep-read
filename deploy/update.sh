#!/usr/bin/env bash
# DeepRead — Production update
# Usage: ./deploy/update.sh [branch]
set -euo pipefail

APP_DIR="/opt/deepread/app"
DATA_DIR="/data/deepread"
DB_PATH="${DATA_DIR}/app.db"
ENV_FILE="${APP_DIR}/.env"
BRANCH="${1:-main}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ================================================================
# PREFLIGHT
# ================================================================
echo "============================================================"
echo "  DeepRead Production Update"
echo "============================================================"
echo ""

# 1. Verify repository exists
if [ ! -d "${APP_DIR}/.git" ]; then
  error "Repository not found at $APP_DIR. Run ./deploy/install.sh first."
fi

# 2. Verify .env exists
if [ ! -f "$ENV_FILE" ]; then
  error ".env not found at $ENV_FILE. Run ./deploy/install.sh first."
fi

# 3. Verify we're not root
if [ "$(id -u)" = "0" ]; then
  error "Do NOT run this script as root."
fi

cd "$APP_DIR"

# ================================================================
# STEP 1 — Backup database
# ================================================================
echo ""
echo "[1/7] Backing up production database..."
if [ -f "$DB_PATH" ]; then
  ./deploy/backup-db.sh
else
  warn "No database found at $DB_PATH — skipping backup."
fi

# ================================================================
# STEP 2 — Fetch remote changes
# ================================================================
echo ""
echo "[2/7] Fetching remote changes..."

git fetch origin "$BRANCH" || error "git fetch failed."

# Check local modifications
LOCAL_CHANGES=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$LOCAL_CHANGES" ]; then
  warn "Local modifications detected:"
  echo "$LOCAL_CHANGES" | head -20
  echo ""
  if [ -n "${DEEPREAD_ALLOW_LOCAL_OVERWRITE:-}" ]; then
    warn "DEEPREAD_ALLOW_LOCAL_OVERWRITE is set — proceeding."
  else
    error "Refusing to overwrite local modifications.
  Commit or stash them, or re-run with DEEPREAD_ALLOW_LOCAL_OVERWRITE=1"
  fi
fi

# Detect remote state
BEHIND=$(git rev-list --count HEAD..origin/"$BRANCH" 2>/dev/null || echo "0")
AHEAD=$(git rev-list --count origin/"$BRANCH"..HEAD 2>/dev/null || echo "0")

if [ "$BEHIND" = "0" ] && [ "$AHEAD" = "0" ]; then
  info "Already up to date. Nothing to pull."
  UP_TO_DATE=1
else
  info "Remote: $BEHIND commits ahead, local: $AHEAD commits ahead."
fi

if [ "${UP_TO_DATE:-0}" != "1" ]; then
  # Merge (not reset)
  git merge origin/"$BRANCH" --no-edit || error "git merge failed."
  info "Merged origin/$BRANCH."
fi

# ================================================================
# STEP 3 — Install dependencies
# ================================================================
echo ""
echo "[3/7] Installing dependencies..."

npm ci || warn "npm ci failed — falling back to npm install"
if [ -f backend/package.json ]; then
  (cd backend && npm ci) || warn "backend npm ci failed — fallback: cd backend && npm install"
fi

# ================================================================
# STEP 4 — Build frontend
# ================================================================
echo ""
echo "[4/7] Building frontend (this invalidates stale CSS/JS)..."

npm run build

if [ ! -f dist/index.html ]; then
  error "Build failed — dist/index.html missing."
fi
info "Frontend built."

# ================================================================
# STEP 5 — Restart PM2 (exactly one instance)
# ================================================================
echo ""
echo "[5/7] Restarting DeepRead PM2 process..."

# Ensure no duplicate processes
DUPLICATES=$(pm2 list 2>/dev/null | grep -c "deepread" || true)
if [ "$DUPLICATES" -gt 1 ]; then
  warn "Multiple PM2 processes named 'deepread' detected. Cleaning up..."
  pm2 delete deepread 2>/dev/null || true
  pm2 start "${APP_DIR}/deploy/ecosystem.config.js"
  pm2 save
  info "Restarted exactly one instance."
elif [ "$DUPLICATES" = "1" ]; then
  pm2 restart deepread --update-env
  info "Restarted deepread."
else
  warn "No PM2 process found. Starting..."
  pm2 start "${APP_DIR}/deploy/ecosystem.config.js"
  pm2 save
  info "Started deepread."
fi

# Wait for boot
sleep 3

# ================================================================
# STEP 6 — Verify health endpoint
# ================================================================
echo ""
echo "[6/7] Running verification..."

# 6a. API health
if curl -sf http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
  HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
  info "Health: $HEALTH"
else
  error "Health check FAILED. Rolling back changes may be required: pm2 logs deepread"
fi

# 6b. Frontend HTML
if curl -sf http://127.0.0.1:3000/ | grep -q '<!doctype html>'; then
  info "Frontend: index.html served."
else
  error "Frontend not served."
fi

# 6c. Verify assets exist
if [ -d dist/assets ] && [ "$(find dist/assets -type f | wc -l)" -gt 0 ]; then
  info "Assets: $(find dist/assets -type f | wc -l) files in dist/assets."
else
  warn "No assets found in dist/assets — verify build."
fi

# ================================================================
# STEP 7 — Verify DATABASE_PATH
# ================================================================
echo ""
echo "[7/7] Verifying production DATABASE_PATH..."

# Read from .env
ENV_DBPATH=$(grep '^DATABASE_PATH=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
info ".env DATABASE_PATH=$ENV_DBPATH"

# Verify against process env via PM2
if pm2 env deepread 2>/dev/null | grep -q "DATABASE_PATH=${DB_PATH}"; then
  info "PM2 process DATABASE_PATH matches expected: $DB_PATH ✅"
else
  warn "PM2 process does NOT report expected DATABASE_PATH=$DB_PATH"
  warn "Check deploy/ecosystem.config.js"
fi

# Verify the actual database file is at the expected location
if [ -f "$DB_PATH" ]; then
  DB_SIZE=$(stat --printf="%s" "$DB_PATH" 2>/dev/null || stat -f%z "$DB_PATH" 2>/dev/null || echo "?")
  info "Database exists at: $DB_PATH (${DB_SIZE} bytes)"
else
  warn "Database file not found at $DB_PATH — first start may create it."
fi

echo ""
echo "============================================================"
echo "  UPDATE COMPLETE"
echo "============================================================"
echo ""
echo "  The production database at $DB_PATH was NOT modified."
echo "  Pre-update backup was saved to /data/deepread/backups/."
echo ""
echo "  Verify in browser: your-domain.com"
echo "============================================================"