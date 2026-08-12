#!/usr/bin/env bash
set -euo pipefail
cd /opt/deepread/app
mkdir -p /data/backups
DATABASE_PATH=/data/app.db npm run db:backup
