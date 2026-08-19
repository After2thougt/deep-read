#!/usr/bin/env bash
# DeepRead Production Installer
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/install.sh
set -euo pipefail

# ============================================================
# ROOT/PM2 SAFETY CHECK
# ============================================================
if [ "$(id -u)" -eq 0 ]; then
  echo "[ERROR] Do NOT run as root. Run as ubuntu user. Script will use sudo internally where needed."
  exit 1
fi

# ============================================================
# CONFIGURATION
# ============================================================
REPO_URL="git@github.com:After2thougt/deep-read.git"
BRANCH="main"
APP_DIR="/opt/deepread/app"
DATA_DIR="/data/deepread"
BACKUP_DIR="${DATA_DIR}/backups"
UPLOAD_DIR="${DATA_DIR}/uploads"
LOG_DIR="${DATA_DIR}/logs"
DB_PATH="${DATA_DIR}/app.db"
ENV_FILE="${APP_DIR}/.env"
ECOSYSTEM_FILE="${APP_DIR}/deploy/ecosystem.config.cjs"
NGINX_SRC="${APP_DIR}/deploy/nginx.conf"
NGINX_DEST="/etc/nginx/sites-available/deepread"
NGINX_ENABLED="/etc/nginx/sites-enabled/deepread"
PM2_NAME="deepread"
PM2_USER="ubuntu"
PM2_HOME="/home/ubuntu"
NODE_MIN_MAJOR=22

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
# PRE-FLIGHT CHECKS
# ============================================================
echo "============================================================"
echo "  DeepRead Production Deployment"
echo "============================================================"

CURRENT_USER=$(whoami)
[ "$CURRENT_USER" = "ubuntu" ] || warn "Running as '$CURRENT_USER', expected 'ubuntu'. Continuing..."

# Ubuntu check
if [ -f /etc/os-release ]; then
  . /etc/os-release
  info "OS: $PRETTY_NAME"
  [ "$ID" = "ubuntu" ] || warn "Non-Ubuntu detected. Proceeding anyway."
fi

# Node.js
command -v node &>/dev/null || error "Node.js not installed. Install Node.js ${NODE_MIN_MAJOR}+ first."
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge "$NODE_MIN_MAJOR" ] || error "Node.js version $(node -v) < ${NODE_MIN_MAJOR}. Required: ${NODE_MIN_MAJOR}+"
info "Node.js $(node -v) ✓"

command -v npm &>/dev/null || error "npm not found"
info "npm $(npm -v) ✓"

# ============================================================
# STEP 1: SYSTEM PACKAGES (require sudo)
# ============================================================
step "1/10 Installing system packages"
sudo apt-get update -qq
sudo apt-get install -y -qq nginx sqlite3 build-essential curl gnupg2

# PM2 global (sudo for global npm)
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2 globally..."
  sudo npm install -g pm2
fi
info "PM2 $(pm2 -v) ready"

# ============================================================
# STEP 2: CLEAN LEGACY DEPLOYMENT
# ============================================================
step "2/10 Cleaning legacy deployment artifacts"

# Remove old systemd service (Node should NOT be managed by systemd)
if [ -f /etc/systemd/system/deepread.service ]; then
  warn "Removing legacy systemd service: /etc/systemd/system/deepread.service"
  sudo systemctl stop deepread 2>/dev/null || true
  sudo systemctl disable deepread 2>/dev/null || true
  sudo rm -f /etc/systemd/system/deepread.service
  sudo systemctl daemon-reload
  info "Legacy systemd service removed"
fi

# Remove old PM2 process if exists
if pm2 list 2>/dev/null | grep -q "$PM2_NAME"; then
  warn "Removing existing PM2 process: $PM2_NAME"
  pm2 stop "$PM2_NAME" 2>/dev/null || true
  pm2 delete "$PM2_NAME" 2>/dev/null || true
fi

# Remove legacy nginx site
[ -f /etc/nginx/sites-enabled/deep-read ] && {
  sudo rm -f /etc/nginx/sites-enabled/deep-read /etc/nginx/sites-available/deep-read
  info "Legacy nginx site removed"
}

# ============================================================
# STEP 3: DIRECTORY STRUCTURE (sudo for creation + chown)
# ============================================================
step "3/10 Creating directory structure"

sudo mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$UPLOAD_DIR" "$LOG_DIR"
sudo chown -R "$CURRENT_USER:$CURRENT_USER" "$APP_DIR" "$DATA_DIR"
sudo chmod 755 "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$UPLOAD_DIR" "$LOG_DIR"
info "Directories created and owned by $CURRENT_USER"

# ============================================================
# STEP 4: CLONE REPOSITORY
# ============================================================
step "4/10 Cloning repository"

if [ -d "${APP_DIR}/.git" ]; then
  warn "Repository already exists at $APP_DIR. Skipping clone."
  info "To re-clone, manually remove $APP_DIR first."
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  info "Cloned: $REPO_URL ($BRANCH)"
fi

# ============================================================
# STEP 5: ENVIRONMENT CONFIGURATION
# ============================================================
step "5/10 Configuring production environment"

cd "$APP_DIR"

if [ -f "$ENV_FILE" ]; then
  warn ".env already exists at $ENV_FILE — preserving."
else
  [ -f backend/.env.example ] || error "Missing backend/.env.example template"
  cp backend/.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  # Apply production defaults
  sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' "$ENV_FILE"
  sed -i 's/^HOST=.*/HOST=127.0.0.1/' "$ENV_FILE"
  sed -i 's/^PORT=.*/PORT=3000/' "$ENV_FILE"
  sed -i 's|^DATABASE_PATH=.*|DATABASE_PATH=/data/deepread/app.db|' "$ENV_FILE"

  warn "============================================================"
  warn "  REQUIRED: Edit $ENV_FILE and set:"
  warn "    OPENAI_API_KEY=your_key"
  warn "    AUTH_USERNAME=your_username"
  warn "    AUTH_PASSWORD=your_password"
  warn "    AUTH_SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || echo 'generate_with_openssl_rand_-hex_32')"
  warn "============================================================"
  read -rp "Press Enter after editing .env (or Ctrl+C to abort)..."
fi

# Verify critical vars
grep -q '^OPENAI_API_KEY=your_key$' "$ENV_FILE" && warn "OPENAI_API_KEY still has placeholder value"
grep -q '^AUTH_USERNAME=$' "$ENV_FILE" && warn "AUTH_USERNAME is empty"
grep -q '^DATABASE_PATH=/data/deepread/app.db' "$ENV_FILE" && info "DATABASE_PATH correctly set to /data/deepread/app.db"

# ============================================================
# STEP 6: DEPENDENCIES
# ============================================================
step "6/10 Installing dependencies"

info "Root dependencies (npm ci)..."
npm ci

if [ -f backend/package.json ]; then
  info "Backend dependencies..."
  (cd backend && npm ci)
else
  info "No backend/package.json — using root node_modules"
fi

# ============================================================
# STEP 7: DATABASE MIGRATIONS
# ============================================================
step "7/10 Running database migrations"
if [ -f "${APP_DIR}/deploy/migrate.sh" ]; then
  bash "${APP_DIR}/deploy/migrate.sh"
else
  warn "No migrate.sh found, skipping migrations"
fi

# ============================================================
# STEP 8: FRONTEND BUILD
# ============================================================
step "8/10 Building frontend"

npm run build
[ -f dist/index.html ] || error "Build failed: dist/index.html not found"
ASSET_COUNT=$(find dist/assets -type f 2>/dev/null | wc -l)
info "Frontend built: $ASSET_COUNT assets"

# ============================================================
# STEP 9: NGINX CONFIGURATION (sudo)
# ============================================================
step "9/10 Configuring Nginx"

[ -f "$NGINX_SRC" ] || error "Nginx template not found: $NGINX_SRC"
sudo cp "$NGINX_SRC" "$NGINX_DEST"
sudo ln -sf "$NGINX_DEST" "$NGINX_ENABLED"
[ -f /etc/nginx/sites-enabled/default ] && sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
info "Nginx configured and reloaded"

# ============================================================
# STEP 10: START PM2 (ubuntu user, NO sudo)
# ============================================================
step "10/10 Starting application via PM2"

[ -f "$ECOSYSTEM_FILE" ] || error "Ecosystem config not found: $ECOSYSTEM_FILE"
pm2 start "$ECOSYSTEM_FILE"
pm2 save

# PM2 systemd startup for ubuntu user (auto-configures on boot)
info "Configuring PM2 startup for user: $PM2_USER, home: $PM2_HOME"
PM2_STARTUP_CMD=$(pm2 startup systemd -u "$PM2_USER" --hp "$PM2_HOME" 2>&1 | grep '^sudo' || true)
if [ -n "$PM2_STARTUP_CMD" ]; then
  warn "============================================================"
  warn "  To enable PM2 auto-start on boot, run this command:"
  warn "  $PM2_STARTUP_CMD"
  warn "============================================================"
else
  info "PM2 startup already configured or detected automatically"
fi

# ============================================================
# HEALTH CHECKS
# ============================================================
step "Health Checks"

sleep 3

# PM2 process
if pm2 show "$PM2_NAME" 2>/dev/null | grep -q "online"; then
  info "PM2 process: ONLINE"
else
  error "PM2 process not online. Check: pm2 logs $PM2_NAME"
fi

# Health API
if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
  HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
  info "Health API: $HEALTH"
else
  error "Health API failed. Check: pm2 logs $PM2_NAME"
fi

# Frontend
if curl -sf http://127.0.0.1:3000/ | grep -q '<!doctype html>'; then
  info "Frontend serving: OK"
else
  error "Frontend not served correctly"
fi

# Database path
[ -f "$DB_PATH" ] && info "Database: $DB_PATH exists" || warn "Database not yet created (will auto-create on first request)"

echo ""
echo "============================================================"
info "DEPLOYMENT COMPLETE"
echo "============================================================"
echo "  App dir:     $APP_DIR"
echo "  Data dir:    $DATA_DIR"
echo "  Database:    $DB_PATH"
echo "  Uploads:     $UPLOAD_DIR"
echo "  Backups:     $BACKUP_DIR"
echo "  Logs:        $LOG_DIR"
echo "  PM2:         pm2 status / pm2 logs $PM2_NAME"
echo "  Update:      bash deploy/update.sh"
echo "  Backup DB:   bash deploy/backup-db.sh"
echo "  Restore DB:  bash deploy/restore-db.sh"
echo "  Import DB:   bash deploy/import-db.sh /path/to/source.db"
echo "  Migrate:     bash deploy/migrate.sh"
echo "  Check:       bash deploy/check.sh"
echo "============================================================"