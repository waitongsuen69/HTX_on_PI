# Repository Guidelines

> Important: Never commit or push without explicit maintainer permission. Before any commit or push, perform a KISS check (Keep It Simple and Small) to ensure the change is minimal, focused, and necessary.

## Project Structure & Module Organization
- `src/`: server and core modules — `server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`, `lots.js`.
- `public/`: static client served by Express — `index.html`, `app.js`, icons, PWA assets.
- `data/`: runtime JSON snapshots (atomic writes). Do not edit while server runs.
- `.env.example`: template for required config. Copy to `.env` locally.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm start`: start Express server (`src/server.js`).
- `npm run dev`: start with auto‑reload via `nodemon`.
- `DRY_RUN=1 npm start`: seed a sample snapshot and skip HTX calls.
- `NO_LISTEN=1 node src/server.js`: run without opening a port (background jobs only).
- Smoke checks (replace `$PORT`):
  - `curl http://localhost:$PORT/api/health`
  - `curl http://localhost:$PORT/api/snapshot`
  - `curl 'http://localhost:$PORT/api/history?n=10'`

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Export with `module.exports = { ... }`.
- Style: 2‑space indentation; include semicolons; single quotes for strings.
- Filenames: lowercase with dashes or plain words (e.g., `server.js`, `calc.js`).
- Structure: keep pure logic in helpers like `calc.js`; small, composable modules in `src/`.
- Config: load via `dotenv`; document new vars in `.env.example`.

## Testing Guidelines
- No formal test suite yet. Prefer `DRY_RUN` and curl smoke checks during development.
- When adding tests: use `supertest` for HTTP; place fixtures under `test/fixtures/`.
- Naming: mirror source paths (e.g., `test/calc.test.js`). Keep core logic pure and testable.

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood; include scope when helpful (e.g., `server: handle NO_LISTEN`).
- PRs: include summary, rationale, and testing steps; add screenshots for UI changes.
- Link related issues; keep PRs focused and incremental.

## Workflow & Permissions
- Do not commit or push without owner approval; request review first.
- KISS law check before commit/push:
  - Keep changes minimal and focused on one objective.
  - Avoid drive‑by refactors, renames, or unrelated formatting.
  - Prefer simplest working solution over complex abstractions.
  - Ensure no secrets or generated files are added.
  - Update docs only where impacted; include brief testing notes.

## Security & Configuration Tips
- Never commit `.env` or secrets; ensure `.gitignore` covers sensitive/generated files.
- Do not edit files in `data/` while the server runs; writes are atomic.
- CSP blocks inline scripts; register the service worker via `public/sw-register.js`.

## Architecture Overview
- Express serves the static UI and JSON APIs.
- Scheduler pulls balances/prices via `src/htx.js`, computes snapshots with `src/calc.js`, and persists state with `src/state.js`.
- PWA assets: `public/manifest.json`, `public/icon-*.png`, and `public/service-worker.js`.
