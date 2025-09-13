# Repository Guidelines

## Project Structure & Module Organization
- `src/`: server and core modules — `server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`, `lots.js`.
- `public/`: static client (served by Express) — `index.html`, `app.js`, assets.
- `data/`: runtime JSON written atomically; do not edit while the server runs.
- `.env.example`: template for required configuration; copy to `.env` locally.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm start`: start Express server (`src/server.js`).
- `npm run dev`: start with auto‑reload via nodemon.
- `DRY_RUN=1 npm start`: seed a sample snapshot and skip HTX calls.
- `NO_LISTEN=1 node src/server.js`: run without opening a port.
- Smoke checks (replace with your `PORT`):
  - `curl http://localhost:$PORT/api/health`
  - `curl http://localhost:$PORT/api/snapshot`
  - `curl 'http://localhost:$PORT/api/history?n=10'`

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Export with `module.exports = { ... }`.
- Style: 2‑space indentation; include semicolons; single quotes for strings.
- Filenames: lowercase with dashes or plain words (e.g., `server.js`, `calc.js`).
- Structure: keep pure logic in helpers like `calc.js`; small, composable modules in `src/`.
- Config: use `dotenv`; document new vars in `.env.example`.

## Testing Guidelines
- No formal test suite yet. Prefer `DRY_RUN` and curl smoke checks during development.
- Keep core logic pure and testable (e.g., functions in `calc.js`).
- When adding tests: use `supertest` for HTTP; place fixtures under `test/fixtures/`.
- Naming: mirror source paths (e.g., `test/calc.test.js`).

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood; include scope when helpful (e.g., `server: handle NO_LISTEN`).
- PRs: include summary, rationale, and testing steps; add screenshots for UI changes.
- Link related issues; keep PRs focused and incremental.

## Security & Configuration Tips
- Never commit `.env` or secrets; ensure `.gitignore` covers sensitive/generated files.
- Do not edit files in `data/` while the server runs; writes are atomic.

## Architecture & PWA Notes
- Express serves the static UI and JSON APIs. Scheduler pulls balances/prices via `htx.js`, computes snapshots with `calc.js`, and persists state with `state.js`.
- PWA: `public/manifest.json`, icons (`public/icon-192.png`, `public/icon-512.png`), and service worker (`public/service-worker.js`) registered via `public/sw-register.js`. CSP blocks inline scripts; keep registration in separate files.
