require('dotenv').config();
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { loadState, addSnapshot, saveStateAtomic } = require('./state');
const { createScheduler } = require('./scheduler');
const { backfillHistoryIfNeeded, captureCurrentSnapshot } = require('./backfill');
const Accounts = require('./accounts');
const { computeChangesFromKlines } = require('./services/marketChange');

// moved kline change computation to services/marketChange (keep server thin)

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
const AUTO_OPEN = String(process.env.AUTO_OPEN || '1').toLowerCase() === '1' || String(process.env.AUTO_OPEN || '1').toLowerCase() === 'true';
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
} else {
  // On boot: ensure history exists (backfill up to 180d if empty) and capture a current snapshot
  (async () => {
    try {
      const days = Number(process.env.BACKFILL_DAYS || 180);
      await backfillHistoryIfNeeded({ days, refFiat: REF_FIAT, minUsdIgnore: MIN_USD_IGNORE, logger: console });
      await captureCurrentSnapshot({ refFiat: REF_FIAT, minUsdIgnore: MIN_USD_IGNORE, logger: console });
    } catch (e) { console.warn('boot init error:', e.message); }
  })();
}

app.get('/api/health', (req, res) => {
  const state = loadState();
  const last = state.history && state.history[state.history.length - 1];
  res.json({ ok: true, now: Date.now(), lastSnapshotAt: last ? last.time * 1000 : null });
});

app.get('/api/snapshot', async (req, res) => {
  const state = loadState();
  const last = Array.isArray(state.history) ? state.history[state.history.length - 1] : null;
  if (!last) return res.status(404).json({ error: 'no_snapshot' });

  try {
    const symbols = (last.positions || []).map(p => p.symbol).filter(Boolean);
    const changes = {};
    for (const base of symbols) {
      changes[base] = await computeChangesFromKlines(base);
    }
    // Fallback using history prices if any change is missing
    const hist = Array.isArray(state.history) ? state.history : [];
    const nowTs = last.time * 1000;
    const t7d = nowTs - 7 * 24 * 60 * 60 * 1000;
    const t30d = nowTs - 30 * 24 * 60 * 60 * 1000;
    function findRefPrice(sym, targetMs) {
      for (let i = hist.length - 1; i >= 0; i--) {
        const snap = hist[i];
        if (!snap || !Array.isArray(snap.positions)) continue;
        const tsMs = (snap.time || 0) * 1000;
        if (tsMs <= targetMs) {
          const pos = snap.positions.find(pp => pp.symbol === sym && pp.price != null);
          if (pos && pos.price > 0) return Number(pos.price);
        }
      }
      return null;
    }
    const enriched = JSON.parse(JSON.stringify(last));
    enriched.positions = (last.positions || []).map(p => {
      const { pnl_pct, unreconciled, day_pct, ...rest } = p;
      let { change_1d_pct, change_7d_pct, change_30d_pct } = changes[p.symbol] || {};
      if (change_1d_pct == null && day_pct != null) change_1d_pct = day_pct;
      if (change_7d_pct == null) {
        const ref = findRefPrice(p.symbol, t7d);
        if (ref && p.price > 0) change_7d_pct = (p.price / ref - 1) * 100;
      }
      if (change_30d_pct == null) {
        const ref = findRefPrice(p.symbol, t30d);
        if (ref && p.price > 0) change_30d_pct = (p.price / ref - 1) * 100;
      }
      return { ...rest, change_1d_pct, change_7d_pct, change_30d_pct };
    });
    res.json(enriched);
  } catch (e) {
    res.json(last);
  }
});

app.get('/api/history', (req, res) => {
  const n = Math.max(1, Math.min(1000, Number(req.query.n || 50)));
  const state = loadState();
  const hist = Array.isArray(state.history) ? state.history.slice(-n) : [];
  res.json({ history: hist });
});

// New Lots routes (Cost Basis Book)
app.use('/api/lots', require('./routes/lots'));
app.use('/api/market', require('./routes/market'));

// Accounts API (sanitized)
app.get('/api/accounts', async (req, res) => {
  try {
    const items = await Accounts.listSanitized();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const body = req.body || {};
    const item = await Accounts.create({
      name: body.name,
      type: body.type,
      platform: body.platform,
      access_key: body.access_key,
      secret_key: body.secret_key,
      chain: body.chain,
      address: body.address,
      enabled: body.enabled,
    });
    res.status(201).json({ item: Accounts.sanitizeAccount(item) });
  } catch (e) {
    const code = e && e.message === 'invalid_account' ? 400 : 500;
    res.status(code).json({ error: e.message || 'server_error' });
  }
});

app.patch('/api/accounts/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const item = await Accounts.update(id, req.body || {});
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ item: Accounts.sanitizeAccount(item) });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const ok = await Accounts.remove(id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.post('/api/accounts/:id/toggle', async (req, res) => {
  try {
    const id = String(req.params.id);
    const item = await Accounts.toggle(id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.post('/api/accounts/:id/ping', async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body || {};
    const item = await Accounts.pingUsage(id, { callsDelta: body.callsDelta || 0 });
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.post('/api/accounts/:id/status', async (req, res) => {
  try {
    const id = String(req.params.id);
    const status = (req.body && req.body.status) || 'ok';
    if (!['ok', 'warn', 'down'].includes(String(status))) return res.status(400).json({ error: 'invalid_status' });
    const item = await Accounts.health(id, status);
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

if (NO_LISTEN) {
  console.log('NO_LISTEN active: skipping HTTP listen.');
  console.log(`REF_FIAT=${REF_FIAT}; PULL_INTERVAL_MS=${INTERVAL_MS}; MIN_USD_IGNORE=${MIN_USD_IGNORE}`);
  // In NO_LISTEN mode, avoid starting the scheduler (which may require network).
  process.exit(0);
}

const server = app.listen(PORT, BIND_ADDR, () => {
  // For simplicity, display localhost URL for users even if binding to a different interface.
  console.log(`HTX Pi Monitor listening on http://localhost:${PORT}`);
  console.log(`REF_FIAT=${REF_FIAT}; PULL_INTERVAL_MS=${INTERVAL_MS}; MIN_USD_IGNORE=${MIN_USD_IGNORE}`);
  if (!DRY_RUN) scheduler.loop();
  if (AUTO_OPEN && !NO_LISTEN) {
    const url = `http://localhost:${PORT}`;
    setTimeout(() => openBrowser(url), 300);
  }
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

function openBrowser(url) {
  const plt = process.platform;
  try {
    if (plt === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      return;
    }
    if (plt === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
      return;
    }
    // Linux (incl. Raspberry Pi)
    const browser = process.env.BROWSER;
    const hasGui = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    if (!hasGui) {
      console.log('AUTO_OPEN skipped: no GUI display detected');
      return;
    }
    if (browser) {
      spawn(browser, [url], { stdio: 'ignore', detached: true }).unref();
      return;
    }
    // Prefer xdg-open when available; fallback to chromium-browser/chromium
    try { spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref(); return; } catch (_) {}
    try { spawn('chromium-browser', [url], { stdio: 'ignore', detached: true }).unref(); return; } catch (_) {}
    try { spawn('chromium', [url], { stdio: 'ignore', detached: true }).unref(); return; } catch (_) {}
  } catch (_) {
    // ignore failure to open browser
  }
}
