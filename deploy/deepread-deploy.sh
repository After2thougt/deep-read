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

git reset --hard origin/main

echo "Installing root dependencies..."
npm ci

echo "Installing backend dependencies..."
if [ -f backend/package.json ]; then
    (cd backend && npm ci)
fi

echo "Building frontend..."
npm run build

# Verify build output
[ -f dist/index.html ] || { echo "[ERROR] Build failed: dist/index.html not found"; exit 1; }

echo "Restarting DeepRead..."
pm2 restart deepread --update-env
sleep 3

# Simple health check
echo "Running health check..."
if ! curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
    echo "[ERROR] Health check failed"
    exit 1
fi

HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
if [ "$HEALTH" != '{"status":"ok"}' ]; then
    echo "[ERROR] Health check unexpected response: $HEALTH"
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploy completed successfully."