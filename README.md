# Vocabulary Trainer

React + Vite frontend with an Express backend for translation, dictionary lookup, AI analysis, and SQLite-backed article and vocabulary storage.

## Local development

```powershell
cd D:\Projects\vocabulary-trainer
npm install
npm --prefix backend install
Copy-Item .env.example .env
npm start
```

For a frontend development server with API proxying:

```powershell
npm run dev
```

Set `DATABASE_PATH=./data/app.db` in `.env` for local storage. The backend creates tables safely with `CREATE TABLE IF NOT EXISTS` and uses SQLite WAL mode. API secrets stay in `.env`; browser code calls only `/api/...`.

## Commands

```powershell
npm run build
npm start
npm run db:backup
npm run db:restore -- D:\backups\app-YYYYMMDDTHHMMSSZ.db
```

Production configuration, Nginx, PM2, HTTPS, backups, updates, and rollback instructions are in [DEPLOY.md](DEPLOY.md).
