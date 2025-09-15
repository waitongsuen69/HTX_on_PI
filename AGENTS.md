> [DO NOT REMOVE] Important: Never commit or push without explicit maintainer permission. Before any commit or push, perform a KISS check (Keep It Simple and Small) to ensure the change is minimal, focused, and necessary.

# Repository Guidelines

## Project Structure & Module Organization
- `src/`: server and core modules — `server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`, `lots.js`.
- `public/`: static client (PWA assets) — `index.html`, `app.js`, icons, service worker.
- `data/`: runtime JSON snapshots (atomic writes). Do not edit while the server runs.
- `.env.example`: template for required config. Copy to `.env` locally.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm start`: start Express server (`src/server.js`).
- `npm run dev`: start with auto‑reload via `nodemon`.
- `npm test`: run Jest test suite.
- `DRY_RUN=1 npm start`: seed a sample snapshot and skip HTX calls.
- `NO_LISTEN=1 node src/server.js`: run background jobs only (no HTTP listener).
- Smoke checks (replace `$PORT`):
  - `curl http://localhost:$PORT/api/health`
  - `curl http://localhost:$PORT/api/snapshot`
  - `curl 'http://localhost:$PORT/api/history?n=10'`

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Export via `module.exports = { ... }`.
- Style: 2‑space indentation; include semicolons; single quotes for strings.
- Filenames: lowercase with dashes or plain words (e.g., `server.js`, `calc.js`).
- Structure: keep pure logic in helpers like `calc.js`; compose small modules in `src/`.

## Testing Guidelines
- Framework: Jest; HTTP tests use `supertest`.
- Naming: `test/**/*.spec.js` (e.g., `test/calc.spec.js`). Keep core logic pure and testable.
- Run: `npm test` (runs in-band on Node).
- During development, also use `DRY_RUN=1` and curl smoke checks.

## Commit & Pull Request Guidelines
- Never commit/push without owner approval. Apply a KISS check before every change.
- Commits: concise, imperative mood; include scope when helpful (e.g., `server: handle NO_LISTEN`).
- PRs: include summary, rationale, and testing steps; add screenshots for UI changes.
- Keep PRs focused and incremental; link related issues; avoid drive‑by refactors.

## Security & Configuration Tips
- Load config via `dotenv`; document new vars in `.env.example`. Never commit `.env` or secrets.
- Ensure `.gitignore` excludes sensitive/generated files.
- CSP blocks inline scripts; register the service worker via `public/sw-register.js`.

## Architecture Overview
- Express serves the static UI and JSON APIs.
- Scheduler pulls balances/prices via `src/htx.js`, computes snapshots with `src/calc.js`, and persists state using `src/state.js`.
- PWA assets live in `public/` (`manifest.json`, `icon-*.png`, `service-worker.js`).
