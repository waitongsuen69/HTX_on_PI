# Repository Guidelines

## Project Structure & Module Organization
- `src/`: server and core modules (`server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`, `lots.js`).
- `public/`: static UI served by Express (`index.html`, `app.js`, assets).
- `data/`: runtime JSON written atomically; generated at runtime.
- `.env.example`: template for required configuration; copy to `.env` locally.

## Build, Test, and Development Commands
- `npm i` — install dependencies.
- `npm start` — start Express server (`src/server.js`).
- `npm run dev` — start with auto‑reload via nodemon.
- Flags/examples:
  - `DRY_RUN=1 npm start` — seed a sample snapshot and skip HTX calls.
  - `NO_LISTEN=1 node src/server.js` — run without opening a port.
- Smoke checks:
  - `curl http://localhost:8080/api/health`
  - `curl http://localhost:8080/api/snapshot`
  - `curl 'http://localhost:8080/api/history?n=10'`

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Export APIs via `module.exports = { ... }`.
- Style: 2‑space indentation; include semicolons; single quotes for strings.
- Filenames: lowercase with dashes or plain words (e.g., `server.js`, `calc.js`).
- Structure: prefer small, composable modules in `src/`; keep pure logic in `calc.js`‑style helpers.
- Config: read via `dotenv`; document new vars in `.env.example`.

## Testing Guidelines
- No formal test suite yet. Use `DRY_RUN` and the curl smoke checks above during development.
- Keep core logic pure and testable (e.g., functions in `calc.js`).
- When adding tests later: prefer `supertest` for HTTP and fixture JSON under `test/fixtures/`.
- Suggested naming: mirror source paths (e.g., `test/calc.test.js`).

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood; include scope if useful (e.g., `server: handle NO_LISTEN`).
- PRs: include summary, rationale, and testing steps. Add screenshots for UI changes.
- Link related issues; keep PRs focused and incremental.

## Security & Configuration Tips
- Never commit `.env` or secrets. Use `.env.example` placeholders.
- Ensure `.gitignore` covers sensitive and generated files.
- Do not edit `data/` while the server is running; files are written atomically.

## Architecture Overview
- Express serves static UI and JSON APIs from `public/` and `src/`.
- Scheduler pulls balances/prices via `htx.js`, computes snapshots with `calc.js`, and persists state with `state.js`.
