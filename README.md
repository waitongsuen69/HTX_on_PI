HTX Pi Monitor
==============

Raspberry Pi web UI for HTX (Huobi) balances. Pulls private balances + public prices and shows per‑asset value, 24h change, and simple P/L vs manual cost basis (JSON). KISS: minimal deps, JSON files, no DB.

Quickstart
----------

- `cp .env.example .env` (set non‑secret runtime vars)
- `npm i`
- `npm start`
- Open `http://<pi-ip>:<PORT>` (default 8080)
- Go to `/accounts.html` and add your HTX account (CEX) with API keys

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
- `data/cost_basis_lots.json` (manual cost basis / lots)
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

- UI: open `/accounts.html` to view and manage accounts (Add/Edit/Delete/Toggle).
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
- `GET /api/lots` (cost basis lots)

Scripts
-------

- `node scripts/list-accounts.js`
- `node scripts/print-account-balances.js --id <ID>`
- `node scripts/print-balances.js`

Troubleshooting
---------------

- No balances: ensure at least one enabled CEX HTX account exists in `/accounts.html` with valid keys.
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
- Sequential lot IDs are maintained in `meta.last_id`.
- P/L% is computed against remaining lots average cost ignoring lots with unknown cost.
- Prices and totals are computed in USD only for now.

Cost Basis (Lots) UI & CSV
--------------------------

- UI: open `/lots.html` for a simple lot book manager (create/edit/delete, import/export, summaries).
- Storage backend: `STORAGE_BACKEND=CSV|JSON` (default `JSON`). Data lives under `./data`.
- CSV header: `id,date,asset,action,qty,unit_cost_usd,note` (see `docs/CSV_FORMAT.md`).
- Actions: `buy|sell|deposit|withdraw`. Sign rules: buy/deposit positive; sell/withdraw negative.
- Matching: LOFO (lowest unit cost out first). Deposits without cost are treated as highest cost for matching.
- Import examples:
  - `curl -F file=@cost_basis_lots.csv http://localhost:$PORT/api/lots/import`
  - `curl -H 'content-type: application/json' -d '{"lots":[...]}" http://localhost:$PORT/api/lots/import`
- Export examples: `/api/lots/export?format=csv` or `?format=json`
- Edits/deletes are blocked once a lot is (partially) consumed by matching.
