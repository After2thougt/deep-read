# DeepRead Deployment Guide

This guide reflects the current repository. It changes no application code.

## Architecture

- Frontend: React + Vite. `npm run build` writes production assets to `dist/`.
- Backend: Express in `backend/server.js`; root `npm start` runs `node backend/server.js`.
- Production static serving: when `NODE_ENV=production`, Express serves `dist/` and returns `dist/index.html` for non-API routes.
- Database: SQLite via `better-sqlite3`, with WAL mode and foreign keys enabled. The database path is `DATABASE_PATH`; without it, it is `data/app.db` inside the repository.
- Production example database path: `/data/app.db`.
- Backend listener defaults: `127.0.0.1:3000`, configurable through `HOST` and `PORT`.
- Reverse proxy: `deploy/nginx.conf` proxies public HTTP traffic to `127.0.0.1:3000` and blocks `.env`, `.git`, `node_modules`, and `data` paths.
- Page behavior: Reader divides article text into roughly 1,800-character pages. Translation and AI analysis send the current page text plus `articleId` and `pageNumber`; their caches are SQLite-backed. Full article content remains stored in `articles`.

The repository contains no PM2 ecosystem file and no systemd unit. The previous project deployment guide uses PM2, so this guide uses PM2 commands directly. The example server directory is `/opt/deepread/app`; change it consistently if your server uses another path.

## Requirements

- Ubuntu server with `git`, `curl`, `nginx`, and Node.js/npm installed.
- The project does not declare a Node.js or npm engine version in `package.json`, `.nvmrc`, or lockfile. Confirm the installed runtime before deployment:

```bash
node --version
npm --version
```

The existing deployment guide used Node.js 22.x. This remains a reasonable example, but the exact production version is a manual confirmation because the repository does not pin one.

- A GitHub checkout of `https://github.com/After2thougt/deep-read.git`.
- Credentials only for the providers you enable. Do not place secrets in frontend code.

## Environment Configuration

`backend/server.js` loads the repository-root `.env` first and then `backend/.env`. Dotenv does not override values already present, so use the root `.env` as the production source of truth. Do not commit either file.

Create the root file from the actual template:

```bash
cd /opt/deepread/app
cp .env.example .env
chmod 600 .env
nano .env
```

Required production settings:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=/data/app.db
AUTH_USERNAME=your-login-name
AUTH_PASSWORD=a-strong-password
AUTH_SESSION_SECRET=a-random-secret
```

Generate the session secret on the server:

```bash
openssl rand -hex 32
```

Provider settings are optional only when their related feature is not used. Current code reads:

| Feature | Required environment variables |
| --- | --- |
| Dictionary | `MERRIAM_WEBSTER_LEARNERS_KEY` |
| Eudic vocabulary sync | `EUDIC_TOKEN` |
| Baidu article translation | `BAIDU_TRANSLATE_APPID`, `BAIDU_AI_TRANSLATE_API_KEY` |
| Tencent translation code path | `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, optional `TENCENT_REGION` |
| OpenAI analysis | `ANALYSIS_PROVIDER=openai`, `OPENAI_API_KEY`, optional `OPENAI_API_BASE`, `OPENAI_API_MODE`, `OPENAI_MODEL` |
| Gemini analysis | `ANALYSIS_PROVIDER=gemini`, `GOOGLE_GEMINI_API_KEY`, optional `GOOGLE_GEMINI_MODEL` |

`CORS_ORIGIN` is optional. With the included same-origin Nginx proxy, leave it empty. If a separate frontend origin is used, set it to that exact origin. `ANALYSIS_PROMPT_VERSION` affects analysis cache keys; retain the value you intend to use.

## First Deployment

The commands below assume the server login user is `ubuntu`. Use your actual non-root service user if different. Do not run `npm install`, `npm ci`, PM2, or the application as root.

### 1. Prepare directories and ownership

```bash
ssh ubuntu@YOUR_SERVER_IP
sudo mkdir -p /opt/deepread /data/backups
sudo chown -R ubuntu:ubuntu /opt/deepread /data
```

The `/data` owner must be able to create `/data/app.db`, `/data/app.db-wal`, `/data/app.db-shm`, and `/data/backups`.

### 2. Install required system software

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx
```

Install Node.js according to your server policy, then verify `node --version` and `npm --version`. PM2 is not included in this repository; install it only if you choose the documented PM2 process management approach:

```bash
sudo npm install -g pm2
pm2 --version
```

### 3. Clone and configure

```bash
git clone https://github.com/After2thougt/deep-read.git /opt/deepread/app
cd /opt/deepread/app
git status
cp .env.example .env
chmod 600 .env
nano .env
```

Set the required environment values listed above. Do not create production credentials in `backend/.env` unless you intentionally understand the root/secondary dotenv precedence.

### 4. Install, build, and initialize SQLite

```bash
cd /opt/deepread/app
npm ci
npm --prefix backend ci
npm run build
```

There is no separate database migration command. On startup, `backend/db.js` creates missing tables/indexes and applies its built-in safe checks. The first process start creates `/data/app.db` when `DATABASE_PATH=/data/app.db` is configured.

### 5. Start with PM2

```bash
cd /opt/deepread/app
pm2 start npm --name deepread -- start
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Run the additional command printed by `pm2 startup` with the required privilege. PM2 inherits the environment from `.env` because the Node application loads that file itself.

### 6. Configure Nginx

```bash
sudo cp /opt/deepread/app/deploy/nginx.conf /etc/nginx/sites-available/deepread
sudo ln -s /etc/nginx/sites-available/deepread /etc/nginx/sites-enabled/deepread
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Open TCP port 80 in the cloud security group/firewall. The supplied Nginx configuration is HTTP only; HTTPS/TLS is **not configured by this repository** and requires manual server configuration.

### 7. Verify

```bash
pm2 status
pm2 logs deepread --lines 100
curl http://127.0.0.1:3000/api/health
curl -I http://127.0.0.1/
ls -lh /data/app.db*
```

Expected health response:

```json
{"status":"ok"}
```

Log in through the browser to test authenticated APIs. Confirm article saving, Vocabulary, dictionary lookup, translation, and analysis using credentials/configuration appropriate to your enabled providers.

## Updating an Existing Deployment

On the development computer:

```bash
git push origin main
```

On the server:

```bash
ssh ubuntu@YOUR_SERVER_IP
cd /opt/deepread/app
git status
git diff
```

Do not continue blindly if `git status` shows local modifications. Preserve or review them first; `.env` is intentionally untracked and should remain on the server.

Back up SQLite before a code update:

```bash
DATABASE_PATH=/data/app.db npm run db:backup
```

Then update:

```bash
git pull --ff-only origin main
npm ci
npm --prefix backend ci
npm run build
pm2 restart deepread
pm2 logs deepread --lines 100
curl http://127.0.0.1:3000/api/health
```

Use `npm ci` because the repository has `package-lock.json`; it installs exactly the locked dependencies and fails if `package.json` and the lockfile disagree. Use `npm install` only when intentionally updating dependencies or regenerating the lockfile, then commit the resulting lockfile from development before deployment.

If `git pull` reports that local changes would be overwritten, inspect them:

```bash
git status
git diff
```

Do not use `git reset --hard` unless you have explicitly confirmed every local server change can be discarded. Do not overwrite `.env` or remove `/data/app.db*` during an update.

## Permissions and EACCES

If npm reports `EACCES: permission denied, open '/opt/deepread/app/package-lock.json'`, first inspect ownership:

```bash
whoami
ls -ld /opt/deepread /opt/deepread/app
ls -l /opt/deepread/app/package-lock.json
```

For the documented `ubuntu` service user, correct a root-owned checkout or dependency tree with:

```bash
sudo chown -R ubuntu:ubuntu /opt/deepread/app
sudo chown -R ubuntu:ubuntu /data
```

Then run `npm ci` again as `ubuntu`, without `sudo`. Do not use `sudo npm install`; it commonly makes `package-lock.json`, `node_modules`, `dist`, or runtime files root-owned and causes this failure later. Keep the SQLite database and its WAL/SHM files owned by the application user.

## Database Backup and Restore

The actual backup command uses `better-sqlite3`'s backup API and creates files in a `backups` directory next to the configured database. With the documented production path:

```bash
cd /opt/deepread/app
DATABASE_PATH=/data/app.db npm run db:backup
ls -lh /data/backups
```

Do not commit `data/`, `*.db`, `*.db-wal`, or `*.db-shm`; `.gitignore` already excludes them. `npm ci` and `npm run build` do not delete SQLite data, but code updates must not delete `/data/app.db`, `/data/app.db-wal`, `/data/app.db-shm`, or `/data/backups`.

Restore only while the application is stopped:

```bash
cd /opt/deepread/app
pm2 stop deepread
DATABASE_PATH=/data/app.db npm run db:restore -- /data/backups/app-YYYYMMDDTHHMMSSZ.db
pm2 start deepread
curl http://127.0.0.1:3000/api/health
```

The restore script creates a pre-restore backup and removes stale WAL/SHM sidecar files after copying the selected backup.

## Troubleshooting

### `npm ci` or `npm install` fails

Check Node/npm versions, ownership, free disk space, and the lockfile state:

```bash
node --version
npm --version
git status
ls -ld /opt/deepread/app
```

If `npm ci` says the lockfile is out of sync, do not repair it directly on the server. Update `package-lock.json` in development, commit it, push it, then pull again.

### `npm run build` fails

Run it from `/opt/deepread/app` after `npm ci`. Check the first compiler error in output. The built output must be `/opt/deepread/app/dist`; production Express serves that directory only when `NODE_ENV=production`.

### Backend does not start or PM2 shows `errored`

```bash
pm2 logs deepread --lines 100
cd /opt/deepread/app
node --check backend/server.js
```

Verify `.env` includes `NODE_ENV=production`, `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_SESSION_SECRET`; the server exits in production when these authentication values are absent.

### Port 3000 is already in use

```bash
ss -ltnp | grep ':3000'
pm2 status
```

Stop or reconfigure the conflicting service. Do not expose port 3000 publicly when Nginx is used; keep `HOST=127.0.0.1`.

### `localhost` works but the public site does not

Check Nginx and the cloud firewall/security group:

```bash
sudo nginx -t
sudo systemctl status nginx
curl -I http://127.0.0.1/
```

Allow TCP port 80 externally. TLS/HTTPS requires manual configuration because no TLS configuration is included.

### Frontend page fails to load

Check that the build completed and production mode is enabled:

```bash
ls -lh /opt/deepread/app/dist/index.html
pm2 logs deepread --lines 100
```

### API returns `401 Authentication required`

The application requires browser login for business APIs. Confirm the configured username/password and browser cookie behavior. For same-origin Nginx use, leave `CORS_ORIGIN` empty; set it only for a known separate frontend origin.

### Dictionary, translation, analysis, or Eudic sync fails

Check PM2 logs and the relevant environment variables in the root `.env`. Current providers are summarized in the environment table. The backend returns provider errors; browser developer tools can show the failing `/api/...` response. Do not put provider keys in Vite or React variables.

### SQLite cannot write

```bash
ls -ld /data
ls -l /data/app.db*
df -h /data
```

Ensure the PM2/application user owns `/data` and has write space. Do not delete `-wal` or `-shm` files while the backend is running.

## Rollback

Inspect recent code first:

```bash
cd /opt/deepread/app
git log --oneline -5
git status
git diff
```

After choosing a known-good commit, create a database backup, then switch the working tree only if server-local changes are intentionally handled:

```bash
DATABASE_PATH=/data/app.db npm run db:backup
git checkout COMMIT_SHA
npm ci
npm --prefix backend ci
npm run build
pm2 restart deepread
curl http://127.0.0.1:3000/api/health
```

`git checkout COMMIT_SHA` changes code but not the SQLite database. It may be blocked by local changes; inspect and preserve them first. Do not use `git reset --hard` unless you explicitly accept losing those local modifications.

To return to the current main branch after a temporary rollback:

```bash
git checkout main
git pull --ff-only origin main
npm ci
npm --prefix backend ci
npm run build
pm2 restart deepread
```
