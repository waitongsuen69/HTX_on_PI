# Repository Guidelines

## Project Structure & Module Organization
- `src/`: server and core modules (`server.js`, `scheduler.js`, `htx.js`, `calc.js`, `state.js`, `lots.js`).
- `public/`: static UI (`index.html`, `app.js`, assets) served by Express.
- `data/`: runtime JSON (created automatically). Do not commit secrets or generated files.
- `.env.example`: template for required configuration; copy to `.env` locally.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm start`: start Express server (`src/server.js`).
- `npm run dev`: start with auto‑reload via nodemon.
- Example flags:
  - `DRY_RUN=1 npm start` seeds a sample snapshot and skips HTX calls.
  - `NO_LISTEN=1 node src/server.js` runs without opening a port (restricted envs).

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Prefer small, composable modules in `src/`.
- Indentation: 2 spaces; include semicolons; single quotes for strings.
- Filenames: lowercase with words separated by dashes or nothing (e.g., `server.js`, `calc.js`).
- Exports: use `module.exports = { ... }` for module APIs.
- Env/config: read via `dotenv` and document new vars in `.env.example`.

## Testing Guidelines
- No formal test suite yet. Use DRY_RUN and API smoke checks:
  - `curl http://localhost:8080/api/health`
  - `curl http://localhost:8080/api/snapshot`
  - `curl 'http://localhost:8080/api/history?n=10'`
- Aim to keep logic pure and testable (e.g., functions in `calc.js`). If adding tests later, prefer `supertest` for HTTP and fixture JSON under a `test/fixtures/` folder.

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood; scope if useful (e.g., `server: handle NO_LISTEN`).
- PRs: include a clear summary, rationale, and testing steps. Add screenshots for UI changes.
- Link related issues. Keep PRs focused; favor small, incremental changes.

## Security & Configuration Tips
- Never commit `.env` or API keys. Use `.env.example` for placeholders.
- Sensitive files are ignored via `.gitignore`; verify before pushing.
- Runtime data is written atomically in `data/`; avoid manual edits while running.

## Architecture Overview
- Express serves static UI and JSON APIs.
- Scheduler pulls balances/prices via `htx.js`, computes snapshots with `calc.js`, and persists state using `state.js` (atomic writes).
