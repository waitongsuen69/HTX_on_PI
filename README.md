HTX Pi Monitor
==============

Raspberry Pi web UI for HTX (Huobi) balances. Pulls private balances + public prices and shows per‑asset value and 24h change. KISS: minimal deps, JSON files, no DB.

Quickstart
----------

- `cp .env.example .env` (set non‑secret runtime vars)
- `npm i`
- `npm start`
- Open `http://<pi-ip>:<PORT>` (default 8080)
- Go to `Settings` (`/settings.html`) and add your HTX account (CEX) with API keys

PWA (Installable App)
---------------------

- Install from Chrome/Edge: look for “Install app” in the address bar.
- Works with any `PORT`; manifest served at `/manifest.json`.
- Service worker: `/service-worker.js` (dev: network-first, no cache).
- Icons: `public/icon-192.png` and `public/icon-512.png` (replace placeholders for branding).

Environment
-----------

- `PORT` default 8080; `BIND_ADDR` default 0.0.0.0
- `REF_FIAT` default USD; `PULL_INTERVAL_MS` default 60000
- `MIN_USD_IGNORE` default 10 (ignore positions worth less than this USD)
- Optional: `DRY_RUN=1`, `NO_LISTEN=1`, `DEBUG=1`

Files
-----

- `data/state.json` (created at runtime)
- `data/accounts.json` (local accounts registry; not committed)

Accounts Registry
-----------------

- Local-only JSON at `data/accounts.json` (gitignored). Example:

```
{
  "meta": { "last_id": 2 },
  "items": [
    { "id": "000001", "name": "HTX_main", "type": "cex", "platform": "HTX", "access_key": "REPLACE", "secret_key": "REPLACE", "enabled": true, "today": {"calls": 0}, "last_used": null, "status": "ok" },
    { "id": "000002", "name": "TronLink_wallet", "type": "dex", "chain": "tron", "address": "Txxxx", "enabled": true, "today": {"calls": 0}, "last_used": null, "status": "ok" }
  ]
}
```

- Tip: protect locally with `chmod 600 data/accounts.json`.
- Secrets never leave the browser; `/api/accounts` is sanitized (no `secret_key`, masked `access_key`).
- Dashboard and scheduler use per‑account HTX credentials from this registry.

Accounts UI & API
-----------------

- UI: open `/settings.html` to view and manage accounts (Add/Edit/Delete/Toggle) and import/export app data.
- API (read‑only sanitized payloads; no secrets returned):
  - `GET /api/accounts` → `{ items: [...] }`
  - `POST /api/accounts/:id/toggle` → `{ ok: true }`
  - `POST /api/accounts/:id/status` → `{ ok: true }`
  - `POST /api/accounts/:id/ping` → `{ ok: true }`

Data APIs
---------

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/history?n=50`

Scripts
-------

- `node scripts/list-accounts.js`
- `node scripts/print-account-balances.js --id <ID>`
- `node scripts/print-balances.js`

Troubleshooting
---------------

- No balances: ensure at least one enabled CEX HTX account exists in `/settings.html` with valid keys.
- No Spot wallet in HTX: create a Spot account in HTX; balances fetch requires it.
- Port/bind errors: change `PORT` or use `BIND_ADDR=127.0.0.1`.
- Restricted env: `NO_LISTEN=1`; use scripts to validate.
- Extra logs: `DEBUG=1` for per‑account balance merge details.

Kiosk (Pi)
----------

```
chromium-browser --kiosk --incognito http://localhost:$PORT
xset s off; xset -dpms; xset s noblank
```

Notes
-----

- Atomic JSON writes are used to survive power loss.
- Prices and totals are computed in USD only for now.
