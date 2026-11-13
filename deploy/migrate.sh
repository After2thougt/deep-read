#!/usr/bin/env bash
# DeepRead Database Migration Runner
# Run as: ubuntu user (NOT root)
# Usage: bash deploy/migrate.sh
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "[ERROR] Do NOT run as root. Run as ubuntu user."
  exit 1
fi

APP_DIR="/opt/deepread/app"
ADMIN_DB_PATH="/data/deepread/app.db"
GUEST_DB_PATH="/data/deepread/guest.db"

if [ "$ADMIN_DB_PATH" = "$GUEST_DB_PATH" ]; then
  echo "[ERROR] Admin and Guest database paths must be different."
  exit 1
fi

if [ ! -f "$ADMIN_DB_PATH" ]; then
  echo "[ERROR] Admin database not found: $ADMIN_DB_PATH"
  exit 1
fi

DATABASE_PATH="$ADMIN_DB_PATH" GUEST_DATABASE_PATH="$GUEST_DB_PATH" \
  node "${APP_DIR}/backend/scripts/migrate.js" --database-path "$ADMIN_DB_PATH"
