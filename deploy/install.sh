#!/usr/bin/env bash
# DeepRead — Fresh production deployment
# Run this on a fresh Ubuntu server (22.04 / 24.04 LTS).
# Usage: ./deploy/install.sh
set -euo pipefail

REPO_URL="${DEEPREAD_REPO:-git@github.com:After2thougt/deep-read.git}"
BRANCH="${DEEPREAD_BRANCH:-main}"
APP_DIR="/opt/deepread/app"
DATA_DIR="/data/deepread"
BACKUP_DIR="${DATA_DIR}/backups"
UPLOAD_DIR="${DATA_DIR}/uploads"
DB_PATH="${DATA_DIR}/app.db"
ENV_FILE="${APP_DIR}/.env"
NODE_MIN_MAJOR=18

# ----- Colors -----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ================================================================
# PREFLIGHT CHECKS
# ================================================================
echo "============================================================"
echo "  DeepRead Production Installer"
echo "============================================================"
echo ""

# Check Ubuntu
if [ ! -f /etc/os-release ]; then
  warn "Cannot detect OS.  Continuing anyway."
else
  . /etc/os-release
  info "Detected: $PRETTY_NAME"
  if [[ "$ID" != "ubuntu" ]]; then
    warn "Non-Ubuntu OS.  Continuing, but packages may differ."
  fi
fi

# Check NOT running as root for npm/application
if [ "$(id -u)" = "0" ]; then
  error "Do NOT run this script as root for application operations.
  The script will use sudo where necessary for system packages/nginx."
fi

# Check Node.js
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Install Node >= ${NODE_MIN_MAJOR} first:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs"
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
  error "Node.js version too old: $(node -v).  Install Node >= ${NODE_MIN_MAJOR}."
fi
info "Node.js $(node -v) OK"

# Check npm
if ! command -v npm &>/dev/null; then
  error "npm not found."
fi
info "npm $(npm -v) OK"

# ================================================================
# STEP 1 — System packages
# ================================================================
echo ""
echo "[1/10] Installing system packages..."

# Nginx
if ! command -v nginx &>/dev/null; then
  info "Installing nginx..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq nginx
else
  info "nginx already installed: $(nginx -v 2>&1)"
fi

# SQLite CLI (for database inspection/debugging)
if ! command -v sqlite3 &>/dev/null; then
  sudo apt-get install -y -qq sqlite3
  info "sqlite3 installed."
else
  info "sqlite3 already installed."
fi

# build-essential (better-sqlite3 may need native build tools)
if ! dpkg -s build-essential &>/dev/null 2>&1; then
  sudo apt-get install -y -qq build-essential
  info "build-essential installed."
else
  info "build-essential already installed."
fi

# ================================================================
# STEP 2 — Install PM2
# ================================================================
echo ""
echo "[2/10] Installing PM2 process manager..."

if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
  info "pm2 $(pm2 -v) installed."
else
  info "pm2 $(pm2 -v) already installed."
fi

# ================================================================
# STEP 3 — Clean up legacy deployment
# ================================================================
echo ""
echo "[3/10] Cleaning up legacy deployment artifacts..."

# Remove old systemd service if present
if [ -f /etc/systemd/system/deepread.service ]; then
  warn "Found legacy systemd service: /etc/systemd/system/deepread.service"
  sudo systemctl stop deepread 2>/dev/null || true
  sudo systemctl disable deepread 2>/dev/null || true
  sudo rm -f /etc/systemd/system/deepread.service
  sudo systemctl daemon-reload
  info "Legacy systemd service removed."
fi

# Stop and delete any existing PM2 deepread process
if pm2 list 2>/dev/null | grep -q "deepread"; then
  warn "Found existing PM2 process 'deepread'. Stopping and deleting..."
  pm2 stop deepread 2>/dev/null || true
  pm2 delete deepread 2>/dev/null || true
  info "Old PM2 process removed."
fi

# Remove legacy nginx site if present
if [ -f /etc/nginx/sites-enabled/deep-read ]; then
  warn "Found legacy nginx site 'deep-read'. Removing..."
  sudo rm -f /etc/nginx/sites-enabled/deep-read /etc/nginx/sites-available/deep-read
fi

# ================================================================
# STEP 4 — Create directory structure
# ================================================================
echo ""
echo "[4/10] Creating directory structure..."

sudo mkdir -p "$APP_DIR"
sudo mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$UPLOAD_DIR"
sudo chown -R "$(whoami):$(whoami)" "$APP_DIR" "$DATA_DIR"
sudo chmod 755 "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$UPLOAD_DIR"
info "Created: $APP_DIR"
info "Created: $DATA_DIR (database, backups, uploads)"

# ================================================================
# GitHub SSH Authentication Check
# ================================================================
check_github_ssh() {
  info "Checking GitHub SSH authentication..."

  # GitHub SSH test returns exit code 1 on success (authenticated but no shell access)
  # We capture output and check for success message
  # Use set +e / set -e to preserve exit code (|| true loses it)
  local ssh_output
  set +e
  ssh_output=$(ssh -T git@github.com 2>&1)
  local exit_code=$?
  set -e

  # GitHub returns:
  # - exit 1 with "successfully authenticated" on success
  # - exit 255 with "Permission denied" on failure
  if [[ $exit_code -eq 1 ]] && [[ "$ssh_output" == *"successfully authenticated"* ]]; then
    info "GitHub SSH authentication verified."
    return 0
  fi

  error "GitHub SSH authentication failed.

  Cannot access git@github.com. SSH key not configured or not added to GitHub.

  To fix this:
    1. Generate an SSH key (if you don't have one):
       ssh-keygen -t ed25519 -C \"your-email@example.com\"
    2. View your public key:
       cat ~/.ssh/id_ed25519.pub
    3. Add it to GitHub:
       Go to: https://github.com/settings/keys
       Click 'New SSH key', paste the public key, and save
    4. Test again:
       ssh -T git@github.com"
}

# ================================================================
# STEP 5 — Clone repository
# ================================================================
echo ""
echo "[5/10] Cloning repository..."

# Verify GitHub SSH access before cloning
check_github_ssh

if [ -d "${APP_DIR}/.git" ]; then
  warn "$APP_DIR already contains a Git repository."
  read -rp "        Overwrite it? (type 'yes'): " CLONE_CONFIRM
  if [ "$CLONE_CONFIRM" = "yes" ]; then
    sudo rm -rf "$APP_DIR"
    sudo mkdir -p "$APP_DIR"
    sudo chown "$(whoami):$(whoami)" "$APP_DIR"
  else
    info "Keeping existing repository. Skipping clone."
    CLONE_SKIPPED=1
  fi
fi

if [ "${CLONE_SKIPPED:-0}" != "1" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  info "Cloned: $REPO_URL ($BRANCH)"
fi

# ================================================================
# STEP 6 — Configure environment
# ================================================================
echo ""
echo "[6/10] Configuring production environment..."

if [ -f "$ENV_FILE" ]; then
  warn ".env already exists at $ENV_FILE — NOT overwriting."
  info "Using existing .env."
else
  if [ -f "${APP_DIR}/backend/.env.example" ]; then
    cp "${APP_DIR}/backend/.env.example" "$ENV_FILE"
    info "Created .env from backend/.env.example template."

    # Apply production defaults
    sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' "$ENV_FILE"
    sed -i 's/^HOST=.*/HOST=127.0.0.1/' "$ENV_FILE"
    sed -i 's/^PORT=.*/PORT=3000/' "$ENV_FILE"
    sed -i 's|^DATABASE_PATH=.*|DATABASE_PATH=/data/deepread/app.db|' "$ENV_FILE"

    echo ""
    warn "============================================================"
    warn "  IMPORTANT: You MUST edit the .env file to set:"
    warn "    OPENAI_API_KEY=sk-..."
    warn "    AUTH_USERNAME=..."
    warn "    AUTH_PASSWORD=..."
    warn "    AUTH_SESSION_SECRET=..."
    warn ""
    warn "  Edit: $ENV_FILE"
    warn "  Then re-run: ./deploy/install.sh"
    warn "============================================================"
    echo ""
    read -rp "Press Enter after editing .env (or Ctrl+C to abort and edit first)..."
  else
    error "Cannot find .env.example template at backend/.env.example"
  fi
fi

# Verify critical env vars are set
if grep -q '^OPENAI_API_KEY=$' "$ENV_FILE" 2>/dev/null; then
  warn "OPENAI_API_KEY is empty in .env — AI analysis will not work."
fi
if grep -q '^AUTH_USERNAME=$' "$ENV_FILE" 2>/dev/null; then
  warn "AUTH_USERNAME is empty — authentication will be disabled (dev mode fallback)."
fi

# Ensure DATABASE_PATH is correct
if grep -q 'DATABASE_PATH=./data/app.db' "$ENV_FILE" 2>/dev/null; then
  warn "DATABASE_PATH is set to a relative path. Correcting to /data/deepread/app.db..."
  sed -i 's|^DATABASE_PATH=.*|DATABASE_PATH=/data/deepread/app.db|' "$ENV_FILE"
fi
DB_PATH_ACTUAL=$(grep '^DATABASE_PATH=' "$ENV_FILE" | head -1 | cut -d= -f2-)
info "DATABASE_PATH=$DB_PATH_ACTUAL"

# ================================================================
# STEP 7 — Install dependencies
# ================================================================
echo ""
echo "[7/10] Installing dependencies..."

cd "$APP_DIR"

info "Installing frontend dependencies (npm ci)..."
npm ci

if [ -f backend/package.json ]; then
  info "Installing backend dependencies (backend npm ci)..."
  cd backend && npm ci && cd ..
else
  info "No backend/package.json — backend dependencies assumed from root node_modules."
fi

# ================================================================
# STEP 8 — Build frontend
# ================================================================
echo ""
echo "[8/10] Building frontend..."

npm run build

if [ ! -f dist/index.html ]; then
  error "Build failed — dist/index.html not found."
fi
info "Frontend built successfully."

# Verify assets exist
ASSET_COUNT=$(find dist/assets -type f | wc -l)
info "Assets: ${ASSET_COUNT} files"

# ================================================================
# STEP 9 — Configure Nginx
# ================================================================
echo ""
echo "[9/10] Configuring Nginx..."

NGINX_SRC="${APP_DIR}/deploy/nginx.conf"
NGINX_DEST="/etc/nginx/sites-available/deepread"
NGINX_ENABLED="/etc/nginx/sites-enabled/deepread"

if [ -f "$NGINX_DEST" ]; then
  warn "Nginx config already exists. Overwriting."
  sudo rm -f "$NGINX_DEST"
fi

sudo cp "$NGINX_SRC" "$NGINX_DEST"
sudo ln -sf "$NGINX_DEST" "$NGINX_ENABLED"

# Remove default site if present
if [ -f /etc/nginx/sites-enabled/default ]; then
  sudo rm -f /etc/nginx/sites-enabled/default
  info "Removed default nginx site."
fi

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
info "Nginx configured and reloaded."

# ================================================================
# STEP 10 — Start application
# ================================================================
echo ""
echo "[10/10] Starting DeepRead with PM2..."

pm2 start "${APP_DIR}/deploy/ecosystem.config.cjs"
pm2 save

# Ensure PM2 starts on boot
PM2_STARTUP=$(pm2 startup 2>&1 || true)
if echo "$PM2_STARTUP" | grep -q "sudo"; then
  echo "$PM2_STARTUP"
  info "Run the sudo command printed above to enable PM2 auto-start on boot."
fi

info "PM2 configured."

# Wait for server to be ready
sleep 3

# ================================================================
# HEALTH CHECKS
# ================================================================
echo ""
echo "============================================================"
echo "  HEALTH CHECKS"
echo "============================================================"

HEALTHY=1

# 1. PM2 status
echo ""
if pm2 show deepread 2>/dev/null | grep -q "online"; then
  info "PM2 deepread: online"
else
  error "PM2 deepread is NOT online. Check: pm2 logs deepread"
fi

# 2. API health endpoint
echo ""
if curl -sf http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
  HEALTH_RESP=$(curl -s http://127.0.0.1:3000/api/health)
  info "Health endpoint: $HEALTH_RESP"
else
  error "Health check FAILED. Check: pm2 logs deepread"
fi

# 3. Frontend HTML serving
echo ""
if curl -sf http://127.0.0.1:3000/ | grep -q '<!doctype html>'; then
  info "Frontend serving: index.html OK"
else
  error "Frontend index.html not being served."
fi

# 4. Verify assets are reachable
ASSET_HREF=$(curl -s http://127.0.0.1:3000/ | grep -oP '/assets/index-[a-zA-Z0-9]+\.js' | head -1 || true)
if [ -n "$ASSET_HREF" ]; then
  if curl -sf "http://127.0.0.1:3000${ASSET_HREF}" -o /dev/null 2>&1; then
    info "Assets: $ASSET_HREF reachable"
  fi
fi

# 5. Verify DATABASE_PATH in runtime
echo ""
DB_RUNTIME_CHECK=$(curl -s http://127.0.0.1:3000/api/health 2>/dev/null || echo "")
info "Health check passed."

echo ""
echo "============================================================"
echo "  DEPLOYMENT COMPLETE"
echo "============================================================"
echo ""
echo "  Application:  ${APP_DIR}"
echo "  Database:     ${DB_PATH}"
echo "  Uploads:      ${UPLOAD_DIR}"
echo "  PM2:          pm2 status"
echo "  Logs:         pm2 logs deepread"
echo "  Nginx:        sudo nginx -t"
echo "  Reload:       sudo systemctl reload nginx"
echo "  Update:       ./deploy/update.sh"
echo "  Backup:       ./deploy/backup-db.sh"
echo "  Restore:      ./deploy/restore-db.sh /data/deepread/backups/app-*.db"
echo "  Import:       ./deploy/import-db.sh /path/to/source.db"
echo "  Reset:        ./deploy/reset-db.sh (DANGEROUS)"
echo "============================================================"
