#!/usr/bin/env bash
# DeepRead Deployment Environment Check
# Verifies that all required components are installed and running correctly.
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS="${GREEN}[PASS]${NC}"
FAIL="${RED}[FAIL]${NC}"
WARN="${YELLOW}[WARN]${NC}"

FAIL_COUNT=0

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "$PASS  $name"
  else
    echo -e "$FAIL  $name"
    ((FAIL_COUNT++))
  fi
}

check_output() {
  local name="$1"
  local cmd="$2"
  local expected="$3"
  local output
  output=$(eval "$cmd" 2>&1 || true)
  if [[ "$output" == *"$expected"* ]]; then
    echo -e "$PASS  $name"
  else
    echo -e "$FAIL  $name (expected: '$expected', got: '$output')"
    ((FAIL_COUNT++))
  fi
}

echo "============================================================"
echo "  DeepRead Deployment Environment Check"
echo "============================================================"
echo ""

# 1. node installed check
check "Node.js installed" "command -v node"

# 2. npm installed check
check "npm installed" "command -v npm"

# 3. pm2 check
check "PM2 installed" "command -v pm2"

# 4. nginx check
check "nginx installed" "command -v nginx"

# 5. PM2 deepread prcess check
check "PM2 deepread process exists" "pm2 list 2>/dev/null | grep -q 'deepread'"

# 6. localhost:3000 responds check
check "localhost:3000 responds" "curl -sf http://127.0.0.1:3000/api/health"

# 7. /data/deepread/app.db exists check
check "Database exists at /data/deepread/app.db" "[ -f /data/deepread/app.db ]"

# 8. frontend dist/index.html exists check
check "Frontend dist/index.html exists" "[ -f /opt/deepread/app/dist/index.html ]"

echo ""
echo "============================================================"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
  exit 0
else
  echo -e "${RED}$FAIL_COUNT check(s) failed.${NC}"
  exit 1
fi