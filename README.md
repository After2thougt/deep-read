# DeepRead

A web application for English article reading, AI-powered analysis, translation, and vocabulary learning.

DeepRead helps you read English articles with built-in translation, grammar analysis, AI explanations, and vocabulary management — all in one place.

## Features

- **Article Reading** — Clean, distraction-free reading experience
- **Translation** — Full-page and paragraph-level translation (Baidu LLM)
- **AI Analysis** — Sentence-level grammar breakdown, key points, vocabulary extraction,phrase collocations (OpenAI)
- **Grammar Analysis** — Difficulty rating, sentence structure mapping, Chinese explanations
- **Vocabulary Management** — Spaced repetition (SM-2), context-aware saving, export to Eudic
- **Dictionary Integration** — Merriam-Webster, Eudic sync, Wiktionary fallback
- **Progress Tracking** — Reading stats, review scheduling, highlight management

## Tech Stack

**Frontend**
- React 19
- Vite 8

**Backend**
- Node.js 22
- Express 5

**Database**
- SQLite (better-sqlite3, WAL mode)

**Production**
- PM2 (process management)
- Nginx (reverse proxy)
- Ubuntu 24.04 LTS

## Project Structure

```
deep-read/
├── frontend/          # React + Vite source (src/, public/, index.html)
├── backend/           # Express API (server.js, routes, db, scripts)
├── deploy/            # Production deployment scripts
│   ├── install.sh
│   ├── update.sh
│   ├── import-db.sh
│   ├── backup-db.sh
│   ├── restore-db.sh
│   ├── migrate.sh
│   ├── check.sh
│   ├── ecosystem.config.cjs
│   └── nginx.conf
├── DEPLOYMENT.md      # Complete production deployment guide
└── README.md          # This file
```

## Quick Start (Development)

### Prerequisites

- Node.js 18+ (22 recommended)
- npm 9+

### Installation

```bash
# Clone and install dependencies
git clone https://github.com/After2thougt/deep-read.git
cd deep-read
npm install
npm --prefix backend install
```

### Environment Configuration

```bash
# Copy local development template
cp backend/.env.example .env
```

Edit `.env` with your local credentials:

```dotenv
NODE_ENV=development
DATABASE_PATH=./data/app.db
AUTH_USERNAME=your-local-user
AUTH_PASSWORD=your-local-password
AUTH_SESSION_SECRET=replace-with-a-local-random-secret
```

> **Note**: `backend/.env.example` is the development template. The root `.env.example` is production-oriented (`NODE_ENV=production`, `DATABASE_PATH=/data/deepread/app.db`) — do not use it for local development.

### Existing Database Migration

If `data/app.db` was created by a version before account-ownership migrations, back it up before starting this version. Then apply the migrations explicitly and start the backend:

```bash
npm run db:backup
npm --prefix backend run db:migrate
npm start
```

The migration command updates only the configured Admin database and does not migrate `guest.db`. It requires an unambiguous legacy account; if it fails, stop and follow the backup/rollback instructions in [DEPLOYMENT.md](./DEPLOYMENT.md#85-account-ownership-migration). `npm start` does not apply migrations automatically.

### Run Development Servers

**Terminal 1 — Backend API (http://127.0.0.1:3000)**

```bash
npm start
```

**Terminal 2 — Frontend Dev Server (http://localhost:5173)**

```bash
npm run dev
```

The Vite dev server proxies `/api` and `/uploads` requests to the backend automatically.

## Available Commands

```bash
# Development
npm run dev          # Start Vite dev server
npm start            # Start Express backend

# Build & Production
npm run build        # Build frontend for production

# Database (run from project root)
npm run db:backup    # Backup SQLite database
npm run db:restore -- /path/to/backup.db  # Restore from backup

# Linting
npm run lint         # Run oxlint
```

## Environment Variables

| Variable | Development | Production | Description |
|----------|-------------|------------|-------------|
| `NODE_ENV` | `development` | `production` | Runtime mode |
| `DATABASE_PATH` | `./data/app.db` | `/data/deepread/app.db` | SQLite file path |
| `HOST` | `127.0.0.1` | `127.0.0.1` | Backend bind address |
| `PORT` | `3000` | `3000` | Backend port |
| `AUTH_USERNAME` | Required | Required | Existing primary account username (regular user after ownership migration) |
| `AUTH_PASSWORD` | Required | Required | Existing primary account password |
| `AUTH_SESSION_SECRET` | Required | Required | Session encryption (32+ chars) |
| `OPENAI_API_KEY` | Optional | Optional | AI analysis (OpenAI) |
| `GOOGLE_GEMINI_API_KEY` | Optional | Optional | AI analysis (Gemini) |
| `EUDIC_TOKEN` | Optional | Optional | Eudic vocabulary sync |
| `BAIDU_TRANSLATE_APPID` | Optional | Optional | Baidu translation |
| `TENCENT_SECRET_ID` | Optional | Optional | Tencent translation |

See `backend/.env.example` for the complete list.

The separate Administrator account is initialized after the account ownership migrations with `npm --prefix backend run db:bootstrap-administrator`. Its username and password are entered interactively; the password is hidden and is never supplied in command-line arguments. Regular accounts are created through the Administrator-only `/api/admin/users` API; role assignment is not accepted through that endpoint.

Authenticated regular-account routes use the session's database and user ID for ownership filtering. Administrator account operations are isolated under `/api/admin/users`; account exports require an Administrator session, and credentials/password hashes are never returned. Browser drafts and per-article reading UI state are namespaced by database and authenticated account ID. Legacy unscoped browser datasets are not imported because their owner cannot be verified.

## Production Deployment

For complete production deployment on Ubuntu 24.04 with PM2 and Nginx, see:

**[DEPLOYMENT.md](./DEPLOYMENT.md)**

The deployment guide covers:
- Server initialization (Ubuntu 24.04, Node.js 22, PM2, Nginx)
- Directory structure (`/opt/deepread/app`, `/data/deepread`)
- First-time deployment (`deploy/install.sh`)
- Daily updates (`deploy/update.sh`)
- Database backup/import/restore/migration
- PM2 process management
- Nginx reverse proxy configuration
- Health checks and troubleshooting

## License

MIT License — see [LICENSE](LICENSE) for details.
