# Repository Guidelines

## Project Structure & Module Organization
- `src/`: server and core modules (`server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`, `lots.js`).
- `public/`: static UI served by Express (`index.html`, `app.js`, assets).
- `data/`: runtime JSON generated at runtime; do not edit or commit.
- `.env.example`: template for required environment variables; copy to `.env` locally.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm start`: start the Express server (`src/server.js`).
- `npm run dev`: start with auto‑reload via nodemon.
- Flags:
  - `DRY_RUN=1 npm start`: seed a sample snapshot; skip HTX API calls.
  - `NO_LISTEN=1 node src/server.js`: run without opening a port (restricted envs).

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Prefer small, composable modules in `src/`.
- Style: 2‑space indent, semicolons, single quotes.
- Filenames: lowercase; words separated by dashes or nothing (e.g., `server.js`, `calc.js`).
- Exports: `module.exports = { ... }` for module APIs.
- Config: read via `dotenv`; document new vars in `.env.example`.

## Testing Guidelines
- No formal test suite yet. Use DRY_RUN and API smoke checks:
  - `curl http://localhost:8080/api/health`
  - `curl http://localhost:8080/api/snapshot`
  - `curl 'http://localhost:8080/api/history?n=10'`
- Keep logic pure and testable (e.g., functions in `calc.js`). If adding tests later, prefer `supertest` for HTTP and fixtures under `test/fixtures/`.

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood; add scope if useful (e.g., `server: handle NO_LISTEN`).
- PRs: include summary, rationale, and testing steps; add screenshots for UI changes.
- Link related issues and keep PRs focused and incremental.

## Security & Configuration Tips
- Never commit `.env` or API keys. Use `.env.example` placeholders.
- Sensitive files are ignored via `.gitignore`; verify before pushing.
- Runtime data is written atomically in `data/`; avoid manual edits while running.

## Architecture Overview
- Express serves static UI and JSON APIs.
- Scheduler pulls balances/prices via `htx.js`, computes snapshots with `calc.js`, and persists state using `state.js`.

