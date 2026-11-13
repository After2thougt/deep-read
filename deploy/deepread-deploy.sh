#!/bin/bash

set -e

APP_DIR="/opt/deepread/app"

cd "$APP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking GitHub..."

git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "No update."
    exit 0
fi

echo "New version detected."
echo "Local : $LOCAL"
echo "Remote: $REMOTE"

bash "$APP_DIR/deploy/update.sh" main