# Vocabulary Trainer

A React + Vite web app with a Node.js backend for paragraph translation, dictionary lookup, and English grammar analysis.

## Project structure

- `src/` — React application, pages, components, API wrappers
- `public/` — static assets
- `backend/` — Express backend for translation, dictionary lookup, and AI analysis
- `vite.config.js` — Vite dev server proxy configured to forward `/api` requests to the backend

## Local setup

1. Install dependencies in the root and backend folders:
   ```bash
   cd d:\Projects\vocabulary-trainer
   npm install
   cd backend
   npm install
   ```

2. Copy backend environment file:
   ```bash
   cd backend
   cp .env.example .env
   ```

3. Fill in `.env` with your API keys and provider configuration.

4. Start the backend server:
   ```bash
   cd backend
   node server.js
   ```

5. Start the frontend app:
   ```bash
   cd d:\Projects\vocabulary-trainer
   npm run dev -- --host 127.0.0.1
   ```

## Backend environment variables

The backend uses `backend/.env` to configure translation and analysis providers. Example values:

- `TRANSLATE_PROVIDER` — `tencent`, `libre`, or `mock`
- `OPENAI_API_BASE` — custom OpenAI/ChatAnywhere proxy URL
- `OPENAI_API_MODE` — `chat_completions` or `responses`
- `GOOGLE_GEMINI_API_KEY` — optional Gemini analysis key

> Do not commit `.env` files. They are ignored by `.gitignore`.

## GitHub upload steps

After installing Git locally, run:

```bash
cd d:\Projects\vocabulary-trainer
git init
git add .
git commit -m "Initial commit"
```

Then create a new repository on GitHub and add the remote:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

## Notes

- The front-end uses a Vite proxy to forward `/api` requests to `http://localhost:3001`.
- The backend includes support for Tencent translation and OpenAI/ChatAnywhere analysis.
- Keep API keys out of Git by using `.env.example` as a template only.
