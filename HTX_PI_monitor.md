# HTX Pi Monitor — Implementation Spec v2 (KISS + Lots/LOFO)

> **Scope**: Single‑platform **HTX** (Huobi) portfolio monitor for Raspberry Pi with a touch‑friendly UI. Pulls REST balances + public prices, computes per‑asset value, 24h change, and **P/L vs cost basis**. **Fees are ignored**. Cost basis supports **manual input** (MVP) and optional **Lots with LOFO** (lowest‑cost‑first deduction) using a single JSON file with **sequential IDs** (e.g., `000001`).

---

## 0) Non‑goals (MVP)

* No WebSocket streams; no trading; no multi‑exchange aggregation.
* No external DB; persistence is JSON files with atomic writes.
* No authentication over WAN by default (LAN/kiosk assumed). No alerts.

---

## 1) Runtime & Deps

* **Node.js 20+** on Raspberry Pi 64‑bit.
* NPM: `express`, `axios`, `dotenv`, `helmet`, `compression`, `morgan`.
* Dev optional: `nodemon`.

---

## 2) Directory Layout

```
raspi-htx-monitor/
├─ src/
│  ├─ server.js        # Express app: APIs + serves /public
│  ├─ htx.js           # HTX REST client (signing for private; public prices)
│  ├─ scheduler.js     # periodic pull loop + backoff
│  ├─ state.js         # in‑mem cache + atomic JSON persistence
│  ├─ calc.js          # valuation & P/L vs cost basis
│  └─ lots.js          # Lots store + LOFO deduction + id generator
├─ public/
│  └─ index.html       # Touch UI (provided previously)
├─ data/
│  ├─ state.json       # snapshots rolling history (created at runtime)
│  └─ cost_basis_lots.json  # manual history / lots with sequential IDs
├─ .env.example
├─ package.json
└─ README.md
```

---

## 3) Environment

```ini
PORT=8080
BIND_ADDR=0.0.0.0
REF_FIAT=USD
PULL_INTERVAL_MS=60000

# HTX credentials (READ‑ONLY)
HTX_ACCESS_KEY=...
HTX_SECRET_KEY=...
HTX_ACCOUNT_ID=...

# Feature flags (all optional)
ENABLE_COST_MANUAL=true      # allow manual avg cost edit in lots file
ENABLE_LOTS_LOFO=true        # enable lots + LOFO deduction (buy/withdraw/sell)
ENABLE_HISTORY_PULL=false    # keep off for MVP (manual first)
HISTORY_DAYS=30
ENABLE_FEES=false            # fees ignored when false (default)
```

**Notes**: Bind to `127.0.0.1` for kiosk‑only. Keep keys read‑only.

---

## 4) External APIs (HTX REST)

* **Balances (private)**: get asset quantities per currency (HMAC‑SHA256 signing).
* **Prices (public)**: last price and 24h % per `SYMBOLUSDT`.
* Time skew tolerance ±5s; implement linear backoff on 429/5xx; 10s request timeout.

---

## 5) Data Persistence (JSON)

### 5.1 `data/state.json` (rolling snapshots)

```json
{
  "history": [
    {
      "time": 1725246000,
      "ref_fiat": "USD",
      "total_value_usd": 12345.67,
      "total_change_24h_pct": -2.15,
      "positions": [
        { "symbol": "BTC", "free": 0.12, "price": 62000, "value": 7440, "day_pct": -1.2, "pnl_pct": 8.3 }
      ]
    }
  ]
}
```

* Keep `MAX_HISTORY = 50` (config constant). Atomic write: temp file → rename.

### 5.2 `data/cost_basis_lots.json` (manual + lots + IDs)

```json
{
  "meta": { "last_id": 3 },
  "BTC": {
    "lots": [
      { "id": "000001", "action": "buy",      "qty": 0.10, "unit_cost": 60000, "ts": "2025-01-01T12:00:00Z" },
      { "id": "000002", "action": "buy",      "qty": 0.20, "unit_cost": 55000, "ts": "2025-01-10T09:30:00Z" },
      { "id": "000003", "action": "withdraw", "qty": 0.15,                    "ts": "2025-02-15T18:20:00Z" }
    ]
  },
  "ETH": { "lots": [] }
}
```

* **Sequential IDs**: on insert, `last_id += 1`, `id = padStart(6)` (e.g., `000004`).
* Actions: `buy` | `sell` | `withdraw` | `deposit`.
* **Fees ignored**: no fee fields; do not adjust qty/cost for fees.
* Unknown‑cost deposits allowed: `unit_cost: null` (UI should highlight).

---

## 6) Cost Basis & LOFO Rules

### 6.1 Actions semantics

* **buy** → append lot `{ qty>0, unit_cost }`.
* **sell** → LOFO deduct lots; **realized P/L may be computed later** (MVP can skip if not needed).
* **withdraw** → LOFO deduct lots; **no realized P/L** (just move out).
* **deposit** → append lot; `unit_cost` can be `null` (unknown). Suggest user edit later.

### 6.2 LOFO deduction

```
1) Sort current lots by unit_cost ascending; `null` treated as +∞ (deduct last).
2) For a negative change (sell/withdraw), walk lots and subtract until qty is covered.
3) Drop empty lots (qty ≤ 1e-12).
```

### 6.3 Average cost of remaining lots

```
qty_total = Σ lot.qty
avg_cost_remaining = qty_total ? Σ(lot.qty * lot.unit_cost) / qty_total : 0
pnl_pct = avg_cost_remaining ? (last_price / avg_cost_remaining - 1) * 100 : 0
```

* Ignore lots with `unit_cost=null` for avg (or compute separately and UI highlight).

---

## 7) Computation Pipeline

* Every `PULL_INTERVAL_MS`:

  1. Pull balances (private).
  2. Pull prices (public, USDT quotes).
  3. Read lots; compute **avg\_cost\_remaining** per symbol (LOFO already reflected in file).
  4. Build snapshot: per‑symbol `value`, `day_pct`, `pnl_pct`; totals & weighted 24h%.
  5. Save to `state.json` (rolling) and serve.
* On errors: keep serving last snapshot; log warn; linear backoff (+30s) per failing endpoint.

---

## 8) API

* `GET /api/health` → `{ ok, now, lastSnapshotAt }`.
* `GET /api/snapshot` → latest snapshot (as in §5.1).
* `GET /api/history?n=50` → `{ history: [...] }`.
* (Optional later) `POST /api/lots` to add/edit entries; for MVP lots are edited by file.

All JSON; errors as `{ error }` with proper HTTP codes.

---

## 9) Touch UI (index.html)

* Provided one‑page UI: totals, 24h%, per‑asset cards, sorting, tap‑to‑pin, long‑press‑hide, auto‑refresh.
* Shows `P/L%` when avg cost exists; otherwise renders `—` and a subtle warning.
* Pulls `/api/snapshot` every 30s; manual refresh button available.

Kiosk launch (Pi):

```
chromium-browser --kiosk --incognito http://localhost:8080
xset s off; xset -dpms; xset s noblank
```

---

## 10) lots.js (Core Behaviors)

* `loadLots()` / `saveLotsAtomic()` → read/write `data/cost_basis_lots.json`.
* `nextId(state)` → increment `meta.last_id`, return 6‑digit string.
* `applyEntry(symbol, {action, qty, unit_cost, ts})` → updates lots per §6.
* `deductLOFO(lots, qty)` → sort by `unit_cost` (null → ∞), subtract, clean zeros.
* `avgCost(symbol)` → returns `avg_cost_remaining` (ignores `unit_cost=null`).

---

## 11) Error Handling & Consistency

* If balances qty ≠ Σ lots.qty (per symbol), flag **unreconciled** in logs and expose a boolean in snapshot (e.g., `positions[].unreconciled=true`). UI can show a yellow dot.
* Missing ticker/price for a symbol: skip its P/L; still include value if possible.
* Atomic JSON writes to avoid corruption on power loss.

---

## 12) Security & Logging

* `helmet`, `compression`, `morgan('tiny')`.
* Do not log secrets; redact on startup.
* Default bind `0.0.0.0` for LAN; consider `127.0.0.1` for kiosk‑only.

---

## 13) Acceptance Checklist

* Runs on Pi; first snapshot within 2 minutes.
* Touch UI renders totals and positions; sorting & touch interactions work.
* Fees ignored; P/L% is computed vs lots avg cost when available.
* LOFO deduction works per spec with a small test set (see §14).
* JSON files survive restarts and partial failures (atomic writes verified).

---

## 14) Minimal Test Scenarios

1. **Two buys + one withdraw (LOFO)**

   * Add `0.10@60k`, `0.20@55k`; withdraw `0.15` → remaining lots `0.05@55k`, `0.10@60k`; avg≈`58,333.33`.
2. **Deposit unknown cost**

   * Add `deposit 0.05, unit_cost=null` → UI should mark symbol as needing cost.
3. **Ticker missing**

   * Simulate no price for a small alt; UI shows `—` for day%/P\&L but keeps value if estimable.
4. **Reconciliation gap**

   * Manually alter lots to mismatch balance by `+0.01` → snapshot sets `unreconciled=true`.

---

## 15) README Quickstart

```
cp .env.example .env  # fill keys
npm i
node src/server.js
# open http://<pi-ip>:8080
```

---

## 16) Future Toggles (off by default)

* `ENABLE_HISTORY_PULL=true` → pull HTX recent trades (30–90d) and map to buy/withdraw entries.
* `ENABLE_COST_MANUAL` UI endpoint to edit/add entries from browser.
* `ENABLE_FEES=true` → introduce optional `fee_usd` fields (backward compatible).
* Realized P/L for `sell` actions and a simple report.

---

**This v2 spec captures:** single‑platform HTX, fees ignored, manual cost basis with optional Lots + LOFO, sequential IDs (`000001`…), touch‑friendly KISS UI, and atomic JSON persistence suitable for Raspberry Pi. Ready for Claude Code implementation.
