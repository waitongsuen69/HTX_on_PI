require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { loadState, addSnapshot, saveStateAtomic } = require('./state');
const { createScheduler } = require('./scheduler');

const PORT = Number(process.env.PORT || 8080);
const BIND_ADDR = process.env.BIND_ADDR || '0.0.0.0';
const REF_FIAT = process.env.REF_FIAT || 'USD';
const INTERVAL_MS = Number(process.env.PULL_INTERVAL_MS || 60_000);
const MIN_USD_IGNORE = Number(process.env.MIN_USD_IGNORE || 10);

const app = express();
app.disable('x-powered-by');
// Configure Helmet: keep CSP defaults; disable HSTS outside production to avoid HTTPS upgrades in dev
app.use(helmet({
  hsts: process.env.NODE_ENV === 'production',
}));
app.use(compression());
app.use(morgan('tiny'));
app.use(express.json());

// Static UI
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// APIs
const scheduler = createScheduler({ intervalMs: INTERVAL_MS, logger: console, refFiat: REF_FIAT, minUsdIgnore: MIN_USD_IGNORE });

// Optional flags
// - DRY_RUN: seed a synthetic snapshot and skip scheduler
// - NO_LISTEN: skip opening a network socket (useful in restricted sandboxes)
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === '1' || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const NO_LISTEN = String(process.env.NO_LISTEN || '').toLowerCase() === '1' || String(process.env.NO_LISTEN || '').toLowerCase() === 'true';
if (DRY_RUN) {
  try {
    const state = loadState();
    const sample = {
      time: Math.floor(Date.now() / 1000),
      ref_fiat: REF_FIAT,
      total_value_usd: 12345.67,
      total_change_24h_pct: 1.23,
      positions: [
        { symbol: 'BTC', free: 0.12, price: 62000, value: 7440, day_pct: -1.2, pnl_pct: 8.3, unreconciled: false },
        { symbol: 'ETH', free: 1.5, price: 3100, value: 4650, day_pct: 0.8, pnl_pct: null, unreconciled: true },
      ],
    };
    addSnapshot(state, sample);
    saveStateAtomic(state);
    console.log('DRY_RUN active: seeded sample snapshot and skipped scheduler.');
  } catch (e) {
    console.warn('DRY_RUN seeding failed:', e.message);
  }
}

app.get('/api/health', (req, res) => {
  const state = loadState();
  const last = state.history && state.history[state.history.length - 1];
  res.json({ ok: true, now: Date.now(), lastSnapshotAt: last ? last.time * 1000 : null });
});

app.get('/api/snapshot', (req, res) => {
  const state = loadState();
  const last = state.history && state.history[state.history.length - 1];
  if (!last) return res.status(404).json({ error: 'no_snapshot' });
  res.json(last);
});

app.get('/api/history', (req, res) => {
  const n = Math.max(1, Math.min(1000, Number(req.query.n || 50)));
  const state = loadState();
  const hist = Array.isArray(state.history) ? state.history.slice(-n) : [];
  res.json({ history: hist });
});

// New Lots routes (Cost Basis Book)
app.use('/api/lots', require('./routes/lots'));

if (NO_LISTEN) {
  console.log('NO_LISTEN active: skipping HTTP listen.');
  console.log(`REF_FIAT=${REF_FIAT}; PULL_INTERVAL_MS=${INTERVAL_MS}; MIN_USD_IGNORE=${MIN_USD_IGNORE}`);
  // In NO_LISTEN mode, avoid starting the scheduler (which may require network).
  process.exit(0);
}

const server = app.listen(PORT, BIND_ADDR, () => {
  const redactedKey = (process.env.HTX_ACCESS_KEY || '').slice(0, 3) + '***';
  // For simplicity, display localhost URL for users even if binding to a different interface.
  console.log(`HTX Pi Monitor listening on http://localhost:${PORT}`);
  console.log(`REF_FIAT=${REF_FIAT}; PULL_INTERVAL_MS=${INTERVAL_MS}; MIN_USD_IGNORE=${MIN_USD_IGNORE}; ACCESS_KEY=${redactedKey}`);
  if (!DRY_RUN) scheduler.loop();
});

server.on('error', (err) => {
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
    console.error(`Permission denied binding ${BIND_ADDR}:${PORT}. Try a different port or set BIND_ADDR=localhost. In restricted environments, set NO_LISTEN=1.`);
  } else if (err && err.code === 'EADDRINUSE') {
    console.error(`Address in use: ${BIND_ADDR}:${PORT}. Choose another PORT.`);
  } else {
    console.error('Server listen error:', err);
  }
  process.exit(1);
});
