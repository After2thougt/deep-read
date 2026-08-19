# DeepRead Production Deployment Handbook

> Version: 2.0  
> Target Environment: Ubuntu 24.04 LTS / Node.js 22 / React + Vite / Express / SQLite / PM2 / Nginx  
> Maintainer: DevOps Team  
> Last Updated: 2025-08-19

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Server Initialization](#2-server-initialization)
3. [Directory Structure](#3-directory-structure)
4. [First-Time Deployment](#4-first-time-deployment)
5. [Environment Configuration](#5-environment-configuration)
6. [Daily Update Workflow](#6-daily-update-workflow)
7. [Database Management](#7-database-management)
8. [Database Migrations](#8-database-migrations)
9. [PM2 Process Management](#9-pm2-process-management)
10. [Nginx Configuration](#10-nginx-configuration)
11. [Health Checks](#11-health-checks)
12. [Troubleshooting](#12-troubleshooting)
13. [Production Operations Standards](#13-production-operations-standards)

---

## 1. System Requirements

### Base Environment

| Component | Version Requirement | Notes |
|-----------|--------------------|-------|
| **Operating System** | Ubuntu 24.04 LTS (Noble) | Recommended LTS for long-term support |
| **Node.js** | 22.x (LTS) | Install via NodeSource repository |
| **npm** | 10.x+ | Bundled with Node.js |
| **PM2** | 5.x+ | Global install: `sudo npm install -g pm2` |
| **Nginx** | 1.24+ | Ubuntu official repository version |
| **SQLite** | 3.45+ | Includes `sqlite3` CLI tool |
| **Git** | 2.43+ | Required for code deployment |
| **build-essential** | Latest | For compiling native modules (better-sqlite3, etc.) |

### Hardware Recommendations

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| Memory | 1 GB | 2 GB+ |
| Disk | 10 GB free | 20 GB+ (database, backups, logs) |
| Network | Public IP + DNS | HTTPS support (Certbot later) |

---

## 2. Server Initialization

### 2.1 Create Deployment User `ubuntu`

> Skip if your cloud provider already provides `ubuntu` user (AWS EC2, Alibaba Cloud ECS, etc.)

```bash
# Run as root
adduser ubuntu --gecos "" --disabled-password
usermod -aG sudo ubuntu

# Optional: passwordless sudo (retain password prompt for production)
echo "ubuntu ALL=(ALL) NOPASSWD:***" | sudo tee /etc/sudoers.d/ubuntu
```

### 2.2 Switch to `ubuntu` User

```bash
# All subsequent deployment operations run as ubuntu
ssh ubuntu@your-server-ip
# or
su - ubuntu
```

### 2.3 Install Base Dependencies

```bash
# Update package index
sudo apt-get update -qq

# Install system packages
sudo apt-get install -y -qq \
    nginx \
    sqlite3 \
    build-essential \
    curl \
    gnupg2 \
    git

# Install Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y -qq nodejs

# Verify versions
node -v   # Should output v22.x.x
npm -v    # Should output 10.x.x

# Install PM2 globally (requires sudo)
sudo npm install -g pm2
pm2 -v    # Should output 5.x.x
```

### 2.4 Configure SSH Key (for GitHub Deployment)

```bash
# Generate Ed25519 key (skip if already exists)
ssh-keygen -t ed25519 -C "your-email@example.com"

# View public key and add to GitHub
cat ~/.ssh/id_ed25519.pub
# GitHub: Settings → SSH and GPG keys → New SSH key

# Test connection
ssh -T git@github.com
# Should show: "Hi username! You've successfully authenticated..."
```

---

## 3. Directory Structure

### 3.1 Production Directory Tree

```
/opt/deepread/
└── app/                          # Application code (Git working tree)
    ├── backend/                  # Express backend
    │   ├── server.js
    │   ├── package.json
    │   ├── .env.example
    │   └── ...
    ├── dist/                     # Frontend build output (npm run build)
    ├── node_modules/             # Dependencies (npm ci)
    ├── deploy/                   # Deployment scripts (read-only, do not modify)
    │   ├── install.sh
    │   ├── update.sh
    │   ├── import-db.sh
    │   ├── backup-db.sh
    │   ├── restore-db.sh
    │   ├── migrate.sh
    │   ├── check.sh
    │   ├── ecosystem.config.cjs
    │   └── nginx.conf
    ├── .env                      # Production env vars (600, not in Git)
    └── package.json

/data/deepread/                   # Persistent data (survives deployments)
├── app.db                        # SQLite main database
├── app.db-wal                    # WAL journal
├── app.db-shm                    # Shared memory
├── uploads/                      # User uploads
│   └── articles/
├── backups/                      # Database backups (auto-retain latest 30)
│   ├── app-20240115T030000Z.db
│   ├── app-pre-import-*.db
│   └── app-pre-restore-*.db
└── logs/                         # PM2 logs
    ├── pm2-out.log
    └── pm2-error.log

/etc/nginx/
├── sites-available/deepread      # Nginx site config
└── sites-enabled/deepread        # Symlink → sites-available/deepread

deploy/migrations/                # Database migration scripts
├── 001-init.sql
├── 002-add-index.sql
└── ...
```

### 3.2 Ownership & Permissions Summary

| Path | Owner | Permissions | Description |
|------|-------|-------------|-------------|
| `/opt/deepread/app` | ubuntu:ubuntu | 755 | Application code |
| `/data/deepread` | ubuntu:ubuntu | 755 | Data root |
| `/data/deepread/app.db` | ubuntu:ubuntu | 644 | Database file |
| `/data/deepread/backups` | ubuntu:ubuntu | 755 | Backup directory |
| `/data/deepread/uploads` | ubuntu:ubuntu | 755 | Uploads directory |
| `/data/deepread/logs` | ubuntu:ubuntu | 755 | Logs directory |
| `/opt/deepread/app/.env` | ubuntu:ubuntu | 600 | Sensitive config |
| `/etc/nginx/sites-available/deepread` | root:root | 644 | Nginx config |

---

## 4. First-Time Deployment

### 4.1 Clone Repository

```bash
# As ubuntu user
cd /tmp
git clone git@github.com:After2thougt/deep-read.git
cd deep-read
```

### 4.2 Run Install Script

```bash
# One-command full deployment
bash deploy/install.sh
```

### 4.3 What `install.sh` Does Automatically

| Step | Description | Execution User |
|------|-------------|----------------|
| 1. System packages | nginx, sqlite3, build-essential, etc. | root (sudo) |
| 2. Clean legacy | Remove old systemd, PM2 process, nginx config | ubuntu |
| 3. Create directories | `/opt/deepread/app`, `/data/deepread/*` | root (sudo mkdir/chown) |
| 4. Clone repository | `git clone git@github.com:After2thougt/deep-read.git` | ubuntu |
| 5. Configure env | Generate `.env` from `.env.example`, set production defaults | ubuntu |
| 6. Install deps | `npm ci` + `backend npm ci` | ubuntu |
| 7. Run migrations | Execute `deploy/migrate.sh` (if exists) | ubuntu |
| 8. Build frontend | `npm run build` → generates `dist/` | ubuntu |
| 9. Configure Nginx | Copy config, test, reload | root (sudo) |
| 10. Start PM2 | `pm2 start ecosystem.config.cjs` + `pm2 save` | ubuntu |
| 11. Configure autostart | `pm2 startup systemd -u ubuntu --hp /home/ubuntu` | ubuntu (run printed sudo cmd) |
| 12. Health checks | API, frontend, database verification | ubuntu |

### 4.4 Edit `.env` with Sensitive Values

Script pauses at step 5 prompting you to edit `.env`. **Required variables:**

```bash
# /opt/deepread/app/.env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=/data/deepread/app.db

# MUST SET THESE
OPENAI_API_KEY=sk-xxx…xxxx
AUTH_USERNAME=your_admin_username
AUTH_PASSWORD=your_s…word
AUTH_SESSION_SECRET=*** rand -hex 32)

# Optional: Third-party services
# EUDIC_TOKEN=
# BAIDU_TRANSLATE_APPID=
# BAIDU_AI_TRANSLATE_API_KEY=
# TENCENT_SECRET_ID=
# TENCENT_SECRET_KEY=
# GOOGLE_GEMINI_API_KEY=
```

Press Enter after editing to continue.

### 4.5 Enable PM2 Autostart (Critical)

`install.sh` outputs a command like this — **must run manually**:

```bash
# Example output (use actual command from script)
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Verify after reboot:

```bash
sudo reboot

# After reboot (as ubuntu)
pm2 list
# Should show deepread process as online
```

---

## 5. Environment Configuration

### 5.1 File Location & Permissions

- **Path**: `/opt/deepread/app/.env`
- **Permissions**: `600` (owner read/write only)
- **Source**: First deploy copies from `backend/.env.example`

### 5.2 Required Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Fixed to `production` | `production` |
| `HOST` | Yes | Backend bind address | `127.0.0.1` |
| `PORT` | Yes | Backend port | `3000` |
| `DATABASE_PATH` | Yes | SQLite path | `/data/deepread/app.db` |
| `OPENAI_API_KEY` | Yes | OpenAI API Key | `sk-xxx` |
| `AUTH_USERNAME` | Yes | Admin username | `admin` |
| `AUTH_PASSWORD` | Yes | Admin password | `StrongP@ssw0rd` |
| `AUTH_SESSION_SECRET` | Yes | Session encryption key | `openssl rand -hex 32` |
| `CORS_ORIGIN` | No | CORS origin | `https://your-domain.com` |

### 5.3 Applying Changes

```bash
# After modifying .env, reload PM2
pm2 reload deepread --update-env
```

---

## 6. Daily Update Workflow

### 6.1 Standard Update Command

```bash
# As ubuntu on server
cd /opt/deepread/app
bash deploy/update.sh [branch-name]
# Default branch: main
```

### 6.2 `update.sh` Execution Flow

```
git pull --ff-only origin main
        ↓
npm ci (root)
        ↓
backend npm ci (if exists)
        ↓
Run Database Migrations (bash deploy/migrate.sh)
        ↓
npm run build (frontend build)
        ↓
pm2 reload deepread --update-env (zero-downtime)
        ↓
Health Check (API + Frontend + Assets)
```

### 6.3 Pre-update Requirements

- Clean working tree (`git status` shows no uncommitted changes)
- Fast-forward merge possible (no conflicts)
- GitHub reachable

### 6.4 Rollback Procedure

```bash
# View commit history
git log --oneline -10

# Rollback to specific commit
git checkout <commit-hash>
bash deploy/update.sh
# Or full redeploy
bash deploy/install.sh
```

---

## 7. Database Management

> **Core Principle**: All database operations **must run as ubuntu user**. Never use `sudo`. All write operations auto-backup current database first.

### 7.1 Backup Database

```bash
# Manual backup
bash deploy/backup-db.sh

# Scheduled backup (crontab -e)
# Daily at 3 AM
0 3 * * * /opt/deepread/app/deploy/backup-db.sh >> /data/deepread/logs/backup.log 2>&1
```

**Backup Features**:
- Uses SQLite `.backup` command (WAL-mode online hot backup)
- Auto-timestamped: `app-20240115T030000Z.db`
- Auto-verifies `PRAGMA integrity_check`
- Auto-retains latest 30, purges older

### 7.2 Import External Database

```bash
# Upload local DB to server
scp app.db ubuntu@your-server:/tmp/app.db

# Import on server (ubuntu user, NO sudo!)
bash deploy/import-db.sh /tmp/app.db
```

**Import Flow**:
1. Verify source DB integrity (`integrity_check`)
2. Verify required tables (`articles`, `article_blocks`, `vocabulary`)
3. Stop PM2 application
4. Auto-backup current production DB (`app-pre-import-<ts>.db`)
5. Copy to temp file → verify → atomic `mv` replace
6. Clean WAL/SHM files
7. Restart PM2 + health check

### 7.3 Restore from Backup

```bash
# Interactive backup selection
bash deploy/restore-db.sh

# Or specify backup file
bash deploy/restore-db.sh /data/deepread/backups/app-20240115T030000Z.db
```

**Restore Flow**:
1. List available backups for selection
2. Stop PM2
3. Auto-backup current DB (`app-pre-restore-<ts>.db`)
4. Copy backup file over
5. Clean WAL/SHM
4. Verify integrity
5. Restart PM2 + health check

---

## 8. Database Migrations

### 8.1 Migration Directory Structure

```
deploy/migrations/
├── 001-init.sql          # Initial schema
├── 002-add-index.sql     # Add indexes
├── 003-add-column.sql    # Add columns
└── ...
```

- Filename format: `<seq>-<description>.sql`
- Executed in lexicographic order
- Each file contains one or more SQL statements

### 8.2 Running Migrations

```bash
# Manual execution (update.sh calls this automatically)
bash deploy/migrate.sh
```

### 8.3 Migration Mechanism

1. Auto-create `migrations` tracking table (if missing)
2. Scan `deploy/migrations/*.sql` sorted by filename
3. Compare against `migrations` table, skip applied
4. Execute pending migrations in transaction
5. Record success in `migrations` table (with `applied_at` timestamp)

### 8.4 Idempotency Guarantee

- Re-running `migrate.sh` **will not** re-apply migrations
- Deduplication by migration ID
- Failed migrations error out without corrupting state

---

## 9. PM2 Process Management

### 9.1 Core Rules

| Allowed | Forbidden |
|---------|-----------|
| `pm2 status` | `sudo pm2 status` |
| `pm2 logs deepread` | `sudo pm2 logs deepread` |
| `pm2 reload deepread` | `sudo pm2 restart deepread` |
| `pm2 stop deepread` | `sudo pm2 start ...` |
| `pm2 save` | `sudo pm2 save` |
| `pm2 startup` | `sudo pm2 startup` |

> **Why**: root and ubuntu have **separate PM2 daemon environments**. Using `sudo pm2` creates root-owned processes invisible to ubuntu's PM2, breaking autostart and process visibility.

### 9.2 Common Commands

```bash
# Status
pm2 status
pm2 show deepread

# Logs
pm2 logs deepread           # Live tail
pm2 logs deepread --lines 200  # Last 200 lines
pm2 logs deepread --err     # Errors only

# Reload (zero-downtime, for daily updates)
pm2 reload deepread --update-env

# Restart (hard restart, for crash recovery)
pm2 restart deepread

# Stop/Delete
pm2 stop deepread
pm2 delete deepread

# Monitor
pm2 monit

# Persist process list (for reboot recovery)
pm2 save
```

### 9.3 Autostart Verification

```bash
# Check systemd service
systemctl status pm2-ubuntu

# Manual reboot test
sudo reboot
# After reboot
pm2 list  # Should show deepread online
```

---

## 10. Nginx Configuration

### 10.1 Config File Locations

- **Source**: `/opt/deepread/app/deploy/nginx.conf`
- **Target**: `/etc/nginx/sites-available/deepread`
- **Enabled**: `/etc/nginx/sites-enabled/deepread` (symlink)

### 10.2 Key Configuration Points

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Block sensitive paths
    location ~ ^/(?:\.env|\.git|node_modules|data)(?:/|$) {
        deny all;
        return 404;
    }

    # Serve uploads directly
    location /uploads/ {
        alias /data/deepread/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Reverse proxy to backend (127.0.0.1:3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 10.3 Common Operations

```bash
# Test config syntax
sudo nginx -t

# Reload (graceful, no connection drop)
sudo systemctl reload nginx

# Restart service
sudo systemctl restart nginx

# Status
sudo systemctl status nginx

# Error logs
sudo tail -f /var/log/nginx/error.log
```

---

## 11. Health Checks

### 11.1 Run Checks

```bash
# Full health check
bash deploy/check.sh
```

### 11.2 Check List

| Category | Check | Pass Criteria |
|----------|-------|---------------|
| **System Deps** | nginx installed/config/running | Command exists, syntax OK, systemd active |
| | Node.js >= 22 | Version check passes |
| | npm / PM2 / sqlite3 / git / curl | Commands exist |
| **PM2 Process** | deepread process exists | `pm2 list` contains it |
| | deepread status online | `pm2 show` shows online |
| | PM2 runs as ubuntu | Process owner verification |
| **App Health** | `/api/health` responds | Returns `{"status":"ok"}` |
| | Frontend served | Returns HTML with `<!doctype html>` |
| | Frontend JS assets reachable | Asset files HTTP 200 |
| **Database** | File exists | `/data/deepread/app.db` exists |
| | Integrity check | `PRAGMA integrity_check = ok` |
| | Writable by ubuntu | ubuntu can write |
| | Critical tables exist | articles, article_blocks, vocabulary |
| | migrations table exists | Migration tracking table |
| **Frontend Build** | dist/index.html exists | File present |
| | Assets non-empty | dist/assets/ has files |
| **Dir Permissions** | Directories exist | All dirs present |
| | Owned by ubuntu | `stat -c %U` = ubuntu |
| **Nginx Proxy** | Site enabled | Symlink exists |
| | Config exists | sites-available/deepread present |

### 11.3 Output Format

```
[OK]     Check passed
[WARN]   Warning (non-blocking, review recommended)
[ERROR]  Failed (blocking, immediate action required)
```

---

## 12. Troubleshooting

### 12.1 PM2 Cannot Find deepread Process

**Symptom**: `pm2 list` empty or missing deepread, though you started it.

**Cause**: Previously used `sudo pm2` → created root PM2 daemon; ubuntu's PM2 daemon is separate.

**Fix**:

```bash
# 1. Confirm current user
whoami  # Must be ubuntu

# 2. Check root PM2
sudo pm2 list

# 3. If root has deepread, clean it
sudo pm2 stop deepread
sudo pm2 delete deepread

# 4. Restart as ubuntu
cd /opt/deepread/app
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

### 12.2 Database Errors

**Symptom**: `SQLITE_CORRUPT`, `database disk image is malformed`, etc.

**Steps**:

```bash
# 1. Integrity check
sqlite3 /data/deepread/app.db "PRAGMA integrity_check;"
# Should output: ok

# 2. If corrupt, restore from backup
bash deploy/restore-db.sh

# 3. Check disk space
df -h /data
# Full disk causes write failures

# 4. Check permissions
ls -la /data/deepread/app.db
# Should be ubuntu:ubuntu 644
```

### 12.3 API Returns 500 / 502

**Steps**:

```bash
# 1. Check PM2 logs
pm2 logs deepread --lines 100

# 2. Test health endpoint
curl -v http://127.0.0.1:3000/api/health

# 3. Common causes
# - .env missing AUTH_* variables
# - Wrong DATABASE_PATH
# - Node version mismatch
# - Port 3000 occupied (ss -ltnp | grep :3000)
```

### 12.4 Frontend Assets 404

**Cause**: `npm run build` not run, build artifacts missing, or Nginx static config issue.

**Fix**:

```bash
# 1. Rebuild
cd /opt/deepread/app
npm run build

# 2. Verify artifacts
ls -la dist/assets/

# 3. Check Nginx proxy for /assets
sudo nginx -t && sudo systemctl reload nginx
```

### 12.5 Nginx 502 Bad Gateway

**Cause**: Upstream (127.0.0.1:3000) down or refusing connections.

**Fix**:

```bash
# 1. Verify backend running
pm2 show deepread
curl http://127.0.0.1:3000/api/health

# 2. Restart if down
pm2 restart deepread
```

---

## 13. Production Operations Standards

### 13.1 Recommended Operations (Standardized)

| Scenario | Recommended Command |
|----------|---------------------|
| **Code Update** | `bash deploy/update.sh` |
| **Database Backup** | `bash deploy/backup-db.sh` (daily cron) |
| **Health Inspection** | `bash deploy/check.sh` (daily/weekly) |
| **Database Import** | `bash deploy/import-db.sh /path/to/db` |
| **Restore from Backup** | `bash deploy/restore-db.sh` |
| **Manual Migration** | `bash deploy/migrate.sh` |
| **View Logs** | `pm2 logs deepread` |
| **Reload App** | `pm2 reload deepread --update-env` |

### 13.2 Forbidden Operations (Red Lines)

| Forbidden | Consequence | Correct Alternative |
|-----------|-------------|---------------------|
| `sudo pm2 ...` | Creates root PM2 env; process invisible, autostart broken | `pm2 ...` (as ubuntu) |
| `sudo npm install` | node_modules owned by root; ubuntu can't write | `npm ci` (as ubuntu) |
| `sudo bash deploy/import-db.sh` | PM2 permission chaos; DB ownership wrong | `bash deploy/import-db.sh` (ubuntu) |
| `sudo bash deploy/update.sh` | Deps/build artifacts owned by root | `bash deploy/update.sh` (ubuntu) |
| `systemctl start/stop deepread` | Node app not managed by systemd directly | `pm2 start/stop/reload deepread` |
| Direct `cp` overwrite `app.db` | Corrupts WAL/SHM → DB corruption | `bash deploy/import-db.sh` or `restore-db.sh` |
| Edit `.env` without PM2 reload | Env vars not applied | `pm2 reload deepread --update-env` |

### 13.3 Change Management Guidelines

1. **All code changes via Git**: Commit → Push → Server `update.sh`
2. **All DB changes via Migrations**: `deploy/migrations/NNN-desc.sql` → auto-run by `migrate.sh`
3. **Secrets only in server `.env`**: Never commit to Git, permissions 600
4. **Regular audits**: Daily `check.sh` + backup log review
5. **Document major ops**: Record time, operator, reason for imports, restores, migrations

---

## Appendix: Quick Reference Card

```bash
# ========== DEPLOY ==========
git clone git@github.com:After2thougt/deep-read.git /tmp/dr && bash /tmp/dr/deploy/install.sh

# ========== UPDATE ==========
bash deploy/update.sh

# ========== DATABASE ==========
bash deploy/backup-db.sh           # Backup
bash deploy/import-db.sh /tmp/db   # Import
bash deploy/restore-db.sh          # Restore
bash deploy/migrate.sh             # Migrate

# ========== PM2 ==========
pm2 status
pm2 logs deepread
pm2 reload deepread --update-env
pm2 save

# ========== NGINX ==========
sudo nginx -t
sudo systemctl reload nginx

# ========== CHECK ==========
bash deploy/check.sh
```

---

**End of Document**  
For questions, refer to script sources or contact the maintainer.