# DeepRead

React + Vite frontend with an Express backend for translation, dictionary lookup, AI analysis, and SQLite-backed article and vocabulary storage.

## Local development

```powershell
cd <path-to-deepread>
npm install
npm --prefix backend install
Copy-Item backend\.env.example .env
```

Edit `.env` and set local login credentials before starting the backend:

```dotenv
NODE_ENV=development
DATABASE_PATH=./data/app.db
AUTH_USERNAME=your-local-user
AUTH_PASSWORD=your-local-password
AUTH_SESSION_SECRET=replace-with-a-local-random-secret
```

Start the backend API at `http://127.0.0.1:3000`:

```powershell
npm start
```

Start the Vite frontend in a second terminal. It proxies `/api` requests to the backend:

```powershell
npm run dev
```

`backend/.env.example` is the local-development template. The root `.env.example` is a production-oriented template, using `NODE_ENV=production` and `DATABASE_PATH=/data/app.db`; do not copy it unchanged for local development. The backend creates tables safely with `CREATE TABLE IF NOT EXISTS` and uses SQLite WAL mode. API secrets stay in `.env`; browser code calls only `/api/...`.

## Commands

```powershell
npm run build
npm start
npm run db:backup
npm run db:restore -- D:\backups\app-YYYYMMDDTHHMMSSZ.db
```

Production configuration, Nginx, PM2, backups, updates, rollback, and TLS/HTTPS requirements are in [DEPLOY.md](DEPLOY.md). TLS/HTTPS is not configured by this repository and must be set up on the server.
