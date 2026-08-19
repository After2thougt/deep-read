#!/usr/bin/env bash
# DeepRead Deployment Health Check
# Run as: ubuntu user
# Usage: bash deploy/check.sh
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
PM2_NAME="deepread"
HEALTH_ENDPOINT="http://127.0.0.1:3000/api/health"

# ============================================================
# COLORS & LOGGING
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

OK="${GREEN}[OK]${NC}"
WARN="${YELLOW}[WARN]${NC}"
ERROR="${RED}[ERROR]${NC}"
INFO="${BLUE}[INFO]${NC}"

FAIL_COUNT=0
WARN_COUNT=0

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "$OK  $label"
    return 0
  else
    echo -e "$ERROR  $label"
    ((FAIL_COUNT++))
    return 1
  fi
}

check_warn() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "$OK  $label"
    return 0
  else
    echo -e "$WARN  $label"
    ((WARN_COUNT++))
    return 1
  fi
}

# ============================================================
# CHECKS
# ============================================================
echo "============================================================"
echo "  DeepRead Deployment Health Check"
echo "============================================================"
echo ""

echo "--- System Dependencies ---"
check "nginx installed" "command -v nginx"
check "nginx config valid" "sudo nginx -t"
check "nginx service active" "systemctl is-active --quiet nginx"
check "Node.js installed" "command -v node"
check "Node.js >= 22" "[ \$(node -v | sed 's/v//' | cut -d. -f1) -ge 22 ]"
check "npm installed" "command -v npm"
check "PM2 installed" "command -v pm2"
check "sqlite3 CLI installed" "command -v sqlite3"
check "git installed" "command -v git"
check "curl installed" "command -v curl"

echo ""
echo "--- PM2 Process ---"
check "PM2 deepread process exists" "pm2 list 2>/dev/null | grep -q $PM2_NAME"
check "PM2 deepread online" "pm2 show $PM2_NAME 2>/dev/null | grep -q online"

# Check PM2 is running as ubuntu user
PM2_USER=$(pm2 show $PM2_NAME 2>/dev/null | grep -i 'username\|user' | head -1 | awk -F: '{print $2}' | xargs || echo "")
if [ -n "$PM2_USER" ] && [ "$PM2_USER" = "ubuntu" ]; then
  echo -e "$OK  PM2 running as ubuntu user"
elif [ -n "$PM2_USER" ]; then
  echo -e "$ERROR  PM2 running as '$PM2_USER', expected 'ubuntu'"
  ((FAIL_COUNT++))
else
  # Fallback: check PM2 daemon user via ps
  PM2_PID=$(pm2 show $PM2_NAME 2>/dev/null | grep 'pid' | head -1 | awk -F: '{print $2}' | xargs || echo "")
  if [ -n "$PM2_PID" ] && [ "$PM2_PID" != "0" ]; then
    PM2_PROCESS_USER=$(ps -o user= -p "$PM2_PID" 2>/dev/null | xargs || echo "")
    if [ "$PM2_PROCESS_USER" = "ubuntu" ]; then
      echo -e "$OK  PM2 process owned by ubuntu"
    elif [ -n "$PM2_PROCESS_USER" ]; then
      echo -e "$ERROR  PM2 process owned by '$PM2_PROCESS_USER', expected 'ubuntu'"
      ((FAIL_COUNT++))
    else
      echo -e "$WARN  Could not determine PM2 process owner"
      ((WARN_COUNT++))
    fi
  else
    echo -e "$WARN  Could not determine PM2 process owner"
    ((WARN_COUNT++))
  fi
fi

echo ""
echo "--- Application Health ---"
check "Health API responds" "curl -sf $HEALTH_ENDPOINT"
HEALTH_RESP=$(curl -s "$HEALTH_ENDPOINT" 2>/dev/null || echo "")
[ "$HEALTH_RESP" = '{"status":"ok"}' ] && echo -e "$OK  Health API returns OK" || { echo -e "$ERROR  Health API unexpected response: $HEALTH_RESP"; ((FAIL_COUNT++)); }

check "Frontend served (port 3000)" "curl -sf http://127.0.0.1:3000/ | grep -q '<!doctype html>'"

# Check assets
ASSET_JS=$(curl -s http://127.0.0.1:3000/ 2>/dev/null | grep -oP '/assets/index-[a-zA-Z0-9]+\.js' | head -1 || true)
if [ -n "$ASSET_JS" ]; then
  check "Frontend JS asset reachable" "curl -sf http://127.0.0.1:3000$ASSET_JS -o /dev/null"
else
  echo -e "$WARN  Could not detect frontend JS asset reference"
  ((WARN_COUNT++))
fi

echo ""
echo "--- Database ---"
check "Database file exists" "[ -f $DB_PATH ]"
check "Database readable (integrity_check)" "sqlite3 $DB_PATH 'PRAGMA integrity_check;' | grep -q ok"
check "Database writable" "[ -w $DB_PATH ]"

# Check critical tables
for table in articles article_blocks vocabulary; do
  check_warn "Table exists: $table" "sqlite3 $DB_PATH '.tables' | grep -qw $table"
done

# Check migrations table
check_warn "Migrations table exists" "sqlite3 $DB_PATH '.tables' | grep -qw migrations"

echo ""
echo "--- Frontend Build ---"
check "dist/index.html exists" "[ -f $APP_DIR/dist/index.html ]"
ASSET_COUNT=$(find "$APP_DIR/dist/assets" -type f 2>/dev/null | wc -l)
[ "$ASSET_COUNT" -gt 0 ] && echo -e "$OK  Frontend assets: $ASSET_COUNT files" || { echo -e "$ERROR  No frontend assets in dist/assets"; ((FAIL_COUNT++)); }

echo ""
echo "--- Directory Structure & Permissions ---"
check "App dir exists" "[ -d $APP_DIR ]"
check "Data dir exists" "[ -d $DATA_DIR ]"
check "Backup dir exists" "[ -d $DATA_DIR/backups ]"
check "Uploads dir exists" "[ -d $DATA_DIR/uploads ]"
check "Logs dir exists" "[ -d $DATA_DIR/logs ]"
check "App dir owned by ubuntu" "[ \$(stat -c %U $APP_DIR) = ubuntu ]"
check "Data dir owned by ubuntu" "[ \$(stat -c %U $DATA_DIR) = ubuntu ]"

echo ""
echo "--- Nginx Proxy ---"
check "Nginx site enabled" "[ -L /etc/nginx/sites-enabled/deepread ]"
check "Nginx proxy config exists" "[ -f /etc/nginx/sites-available/deepread ]"

# ============================================================
# SUMMARY
# ============================================================
echo ""
echo "============================================================"
if [ $FAIL_COUNT -eq 0 ]; then
  if [ $WARN_COUNT -eq 0 ]; then
    echo -e "${GREEN}ALL CHECKS PASSED${NC}"
  else
    echo -e "${GREEN}ALL CRITICAL CHECKS PASSED${NC} (${WARN_COUNT} warnings)"
  fi
  exit 0
else
  echo -e "${RED}$FAIL_COUNT CRITICAL CHECK(S) FAILED${NC}"
  [ $WARN_COUNT -gt 0 ] && echo -e "${YELLOW}$WARN_COUNT WARNING(S)${NC}"
  exit 1
fi