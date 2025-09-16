> [DO NOT REMOVE] Important: Never commit or push without explicit maintainer permission. Before any commit or push, perform a KISS check (Keep It Simple and Small) to ensure the change is minimal, focused, and necessary.

# Repository Guidelines

## Project Structure & Module Organization
- `src/`: core server — `server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`.
- `src/services/`, `src/routes/`, `src/onchain/`: HTTP routes and on‑chain providers (`tron.js`, `cardano.js`).
- `public/`: static PWA — `index.html`, `app.js`, `settings.html`, `service-worker.js`, icons.
- `test/`: Jest specs (`test/**/*.spec.js`).
- `data/`: runtime JSON snapshots (atomic writes). Do not edit while the server runs.
- `.env.example`: copy to `.env` and fill required keys.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm start`: start Express server (`src/server.js`).
- `npm run dev`: start with auto‑reload (`nodemon`).
- `npm test`: run Jest tests (in‑band).
- `DRY_RUN=1 npm start`: seed a sample snapshot; skip HTX calls.
- `NO_LISTEN=1 node src/server.js`: run background jobs only.
- Smoke checks (replace `$PORT`):
  - `curl http://localhost:$PORT/api/health`
  - `curl http://localhost:$PORT/api/snapshot`
  - `curl 'http://localhost:$PORT/api/history?n=10'`

## Coding Style & Naming Conventions
- Node.js (CommonJS). Export via `module.exports = { ... }`.
- 2‑space indentation; semicolons; single quotes.
- Filenames: lowercase with dashes or plain words (`server.js`, `calc.js`).
- Keep pure logic in helpers; compose small modules in `src/`.

## Testing Guidelines
- Framework: Jest; HTTP tests use `supertest`; UI tests run with jsdom.
- Naming: `test/**/*.spec.js`.
- Run locally: `npm test`. Prefer pure, deterministic units.

## Commit & Pull Request Guidelines
- Never commit/push without owner approval. Run a KISS check (Keep It Simple and Small) before every change.
- Commits: concise, imperative (e.g., `server: handle NO_LISTEN`).
- PRs: include summary, rationale, steps to test; screenshots for UI. Keep focused and incremental; link issues.

## Security & Configuration Tips
- Load config via `dotenv`; document new vars in `.env.example`. Never commit `.env` or secrets.
- Relevant keys: `TRON_FULLNODE`, `CARDANO_PROVIDER=blockfrost`, `BLOCKFROST_PROJECT_ID`.
- CSP blocks inline scripts; register the service worker via `public/sw-register.js`.

## Architecture Overview
- Express serves static UI and JSON APIs.
- Scheduler aggregates CEX (HTX) and on‑chain balances (TRON, Cardano), prices assets, and persists snapshots.
- PWA assets live under `public/` (`manifest.json`, `icon-*.png`, `service-worker.js`).
