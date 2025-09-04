HTX Pi Monitor
==============

Raspberry Pi web UI for HTX (Huobi) balances. Pulls private balances + public prices and shows per‑asset value, 24h change, and simple P/L vs manual cost basis (JSON). KISS: minimal deps, JSON files, no DB.

Quickstart
----------

- `cp .env.example .env` and fill HTX keys
- `npm i`
- `npm start` (or `node src/server.js`)
- Open `http://<pi-ip>:8080`

Environment
-----------

- `PORT` default 8080; `BIND_ADDR` default 0.0.0.0
- `REF_FIAT` default USD; `PULL_INTERVAL_MS` default 60000
- `HTX_ACCESS_KEY`, `HTX_SECRET_KEY`, `HTX_ACCOUNT_ID`
- Optional: `DRY_RUN=1`, `NO_LISTEN=1`, `DEBUG=1`

Files
-----

- `data/state.json` (created at runtime)
- `data/cost_basis_lots.json` (manual cost basis / lots)

APIs
----

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

- Missing keys: set `HTX_ACCESS_KEY` and `HTX_SECRET_KEY` in `.env`.
- No Spot account: ensure Spot wallet exists or set `HTX_ACCOUNT_ID`.
- Port/bind errors: change `PORT` or use `BIND_ADDR=127.0.0.1`.
- Restricted env: `NO_LISTEN=1`; use scripts to validate.
- Extra logs: `DEBUG=1` for per‑account balance merge details.

Kiosk (Pi)
----------

```
chromium-browser --kiosk --incognito http://localhost:8080
xset s off; xset -dpms; xset s noblank
```

Notes
-----

- Atomic JSON writes are used to survive power loss.
- Sequential lot IDs are maintained in `meta.last_id`.
- P/L% is computed against remaining lots average cost ignoring lots with unknown cost.
- Prices and totals are computed in USD only for now.
