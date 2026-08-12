# Production Deployment

This guide targets Ubuntu 24.04 LTS. The service is available through the server public IP over HTTP. Nginx is the only public listener; Node stays on `127.0.0.1:3000`.

## Prepare the server

Allow TCP ports `22` and `80` in the cloud firewall/security group. Do not expose port `3000` or `443`.

```bash
ssh ubuntu@YOUR_SERVER_IP
apt update
apt upgrade -y
apt install -y ca-certificates curl git nginx ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable
```

## Install and start

```bash
sudo mkdir -p /opt/deepread/logs /data/backups
sudo chown -R ubuntu:ubuntu /opt/deepread /data
git clone YOUR_GIT_URL /opt/deepread/app
cd /opt/deepread/app
npm install
npm --prefix backend install
cp .env.example .env
nano .env
```

Set `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, and `DATABASE_PATH=/data/app.db` in `.env`, along with only the provider credentials you use. Also set a unique `AUTH_USERNAME`, a strong `AUTH_PASSWORD`, and a randomly generated `AUTH_SESSION_SECRET` (for example, `openssl rand -hex 32`). Secrets are never placed in the frontend or Git.

```bash
npm run build
DATABASE_PATH=/data/app.db NODE_ENV=production pm2 start npm --name deepread -- start
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
ss -ltnp | grep ':3000'
curl http://127.0.0.1:3000/api/health
```

Run the command printed by `pm2 startup`. The first application start creates `/data/app.db` and tables without deleting existing data.

## Nginx (public IP over HTTP)

```bash
cd /opt/deepread/app
sudo cp deploy/nginx.conf /etc/nginx/sites-available/deepread
sudo ln -s /etc/nginx/sites-available/deepread /etc/nginx/sites-enabled/deepread
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Nginx is the public endpoint and proxies to `127.0.0.1:3000`. Its configuration blocks `/data`, `.env`, `.git`, and `node_modules` from HTTP access.

## Backup and restore

```bash
cd /opt/deepread/app
DATABASE_PATH=/data/app.db npm run db:backup
ls -lh /data/backups
```

Backups use SQLite's `better-sqlite3` backup API. For daily 03:00 backups:

```bash
sudo tee /etc/cron.d/deepread-backup > /dev/null <<'EOF'
0 3 * * * ubuntu /opt/deepread/app/deploy/backup.sh >> /opt/deepread/logs/backup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/deepread-backup
```

Restore only while the process is stopped. The command backs up the current database first.

```bash
cd /opt/deepread/app
pm2 stop deepread
DATABASE_PATH=/data/app.db npm run db:restore -- /data/backups/app-YYYYMMDDTHHMMSSZ.db
DATABASE_PATH=/data/app.db NODE_ENV=production pm2 start deepread
curl http://127.0.0.1:3000/api/health
```

## Update and rollback

Never remove `/data/app.db`, its WAL files, or `/data/backups` during an update.

```bash
cd /opt/deepread/app
git pull --ff-only origin main
npm install
npm --prefix backend install
npm run build
DATABASE_PATH=/data/app.db NODE_ENV=production pm2 restart deepread
pm2 logs deepread --lines 100
```

Before risky changes, run `DATABASE_PATH=/data/app.db npm run db:backup`. To roll back code, use `git checkout COMMIT_SHA`, reinstall dependencies, build, and restart PM2. Do not alter `/data`.

## Production validation

```bash
pm2 status
systemctl status nginx
curl -I http://YOUR_SERVER_IP/
curl http://127.0.0.1:3000/api/health
```

Login is required before the browser can use application APIs. Nginx, PM2 boot startup, cloud firewall, public-IP reachability, and disk persistence require verification on the actual server.
