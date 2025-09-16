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
const { computeBaselinePrice, pctChange } = require('./services/historicalPrice');
const ExProvider = require('./services/exchangeProvider');

// moved kline change computation to services/marketChange (keep server thin)

const PORT = Number(process.env.PORT || 8080);
const BIND_ADDR = process.env.BIND_ADDR || '0.0.0.0';
const REF_FIAT = process.env.REF_FIAT || 'USD';
const INTERVAL_MS = Number(process.env.PULL_INTERVAL_MS || 60_000);

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
const scheduler = createScheduler({ intervalMs: INTERVAL_MS, logger: console, refFiat: REF_FIAT, getMinUsdIgnore: async () => {
  try { const cfg = await Accounts.getAppConfig(); return cfg.min_usd_ignore; } catch (_) { return 10; }
} });

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
      const appCfg = await Accounts.getAppConfig();
      await backfillHistoryIfNeeded({ days, refFiat: REF_FIAT, minUsdIgnore: appCfg.min_usd_ignore, logger: console });
      await captureCurrentSnapshot({ refFiat: REF_FIAT, minUsdIgnore: appCfg.min_usd_ignore, logger: console });
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
    const baselineMode = String(req.query.baselineMode || 'close').toLowerCase() === 'vwap' ? 'vwap' : 'close';
    // Fetch current prices once for all symbols
    const nowPrices = await ExProvider.fetchCurrentPrices(symbols);
    // Also compute daily changes via klines for 24h as before
    const changes = {};
    for (const base of symbols) {
      changes[base] = await computeChangesFromKlines(base);
    }
    // Fallback using history prices if any change is missing
    const hist = Array.isArray(state.history) ? state.history : [];
    const nowTs = last.time * 1000;
    // Determine UTC days for 7d/30d ago (baseline day start)
    const dayMs = 24 * 60 * 60 * 1000;
    const t7d = nowTs - 7 * dayMs;
    const t30d = nowTs - 30 * dayMs;
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
    // Compute baselines for symbols (7d/30d) using the selected mode
    const baselineCache = new Map(); // key: base|tMs|mode
    async function baseline(base, tMs) {
      const key = `${base}|${tMs}|${baselineMode}`;
      if (baselineCache.has(key)) return baselineCache.get(key);
      const v = await computeBaselinePrice(base, tMs, baselineMode);
      baselineCache.set(key, v);
      return v;
    }
    const posOut = [];
    let sumNow = 0;
    let sum7 = 0;
    let sum30 = 0;
    for (const p of (last.positions || [])) {
      const { pnl_pct, unreconciled, day_pct, ...rest } = p;
      const sym = p.symbol;
      const nowPrice = Number(nowPrices[sym] || p.price || 0);
      let { change_1d_pct } = changes[sym] || {};
      if (change_1d_pct == null && day_pct != null) change_1d_pct = day_pct;

      // Baseline prices
      let b7 = await baseline(sym, t7d);
      let b30 = await baseline(sym, t30d);
      // Fallback to history if missing
      if (!(b7 > 0)) b7 = findRefPrice(sym, t7d);
      if (!(b30 > 0)) b30 = findRefPrice(sym, t30d);
      const change_7d_pct = pctChange(nowPrice, b7);
      const change_30d_pct = pctChange(nowPrice, b30);

      // Aggregate portfolio baselines using current quantities
      const qty = Number(p.free || 0);
      const worthNow = qty * nowPrice;
      sumNow += worthNow;
      if (b7 > 0) sum7 += qty * b7;
      if (b30 > 0) sum30 += qty * b30;

      posOut.push({ ...rest, price: nowPrice || rest.price, change_1d_pct, change_7d_pct, change_30d_pct });
    }
    enriched.positions = posOut;
    // Portfolio level changes
    enriched.total_change_7d_pct = pctChange(sumNow, sum7);
    enriched.total_change_30d_pct = pctChange(sumNow, sum30);
    enriched.baseline_mode = baselineMode;
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

app.use('/api/market', require('./routes/market'));

// Accounts API (sanitized)
app.get('/api/accounts', async (req, res) => {
  try {
    const items = await Accounts.listSanitized();
    const tronCfg = await Accounts.getTronConfig();
    const cardano = await Accounts.getCardanoConfig();
    const tron = { api_key: tronCfg.api_key || '' }; // do not expose fullnode
    res.json({ items, tron, cardano });
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
      track_by: body.track_by,
      stake: body.stake,
      addresses: body.addresses,
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
    const code = e && e.message === 'invalid_account' ? 400 : 500;
    res.status(code).json({ error: e.message || 'server_error' });
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

// Shared TRON config (API key/fullnode)
app.get('/api/tron-config', async (req, res) => {
  try {
    const cfg = await Accounts.getTronConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.patch('/api/tron-config', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = await Accounts.setTronConfig({ api_key: body.api_key });
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// Shared Cardano config (Blockfrost project id)
app.get('/api/cardano-config', async (req, res) => {
  try {
    const cfg = await Accounts.getCardanoConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.patch('/api/cardano-config', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = await Accounts.setCardanoConfig({ project_id: body.project_id });
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// App config (min_usd_ignore)
app.get('/api/app-config', async (req, res) => {
  try {
    const cfg = await Accounts.getAppConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

app.patch('/api/app-config', async (req, res) => {
  try {
    const body = req.body || {};
    const min = Number(body.min_usd_ignore);
    if (!Number.isFinite(min) || min < 0) return res.status(400).json({ error: 'invalid_min_usd_ignore' });
    const cfg = await Accounts.setAppConfig({ min_usd_ignore: min });
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// Account assets (details, on-demand; sanitized; no secrets returned)
app.get('/api/accounts/:id/assets', async (req, res) => {
  try {
    const id = String(req.params.id);
    const raw = await Accounts.getRawById(id);
    if (!raw) return res.status(404).json({ error: 'not_found' });

    if (raw.type === 'cex' && String(raw.platform || '').toUpperCase() === 'HTX') {
      // Use per-account HTX client to fetch spot vs stake (lending) balances
      const { createHTXClient } = require('./htx');
      try {
        const client = createHTXClient({ accessKey: raw.access_key, secretKey: raw.secret_key, accountId: raw.account_id || '' });
        const { spot, stake } = await client.getBalancesByType(); // { spot: {SYM:num}, stake:{SYM:num} }
        const items = [];
        for (const [sym, qty] of Object.entries(spot || {})) {
          if (qty > 0) items.push({ source: 'cex', platform: 'HTX', symbol: sym.toUpperCase(), qty: Number(qty) });
        }
        for (const [sym, qty] of Object.entries(stake || {})) {
          if (qty > 0) items.push({ source: 'cex', platform: 'HTX', symbol: `${sym.toUpperCase()}(stake)`, qty: Number(qty) });
        }
        return res.json({ items });
      } catch (e) {
        return res.json({ items: [], error: 'fetch_failed', message: e.message });
      }
    }

    if (raw.type === 'dex' && String(raw.chain || '').toLowerCase() === 'tron') {
      try {
        const tron = require('./onchain/tron');
        const pos = await tron.getBalances([raw.address]);
        const items = [];
        for (const p of pos) {
          const qty = Number(p.qty || 0);
          if (qty > 0) items.push({ source: 'dex', chain: 'tron', symbol: p.symbol, qty });
        }
        return res.json({ items });
      } catch (e) {
        return res.json({ items: [], error: 'fetch_failed', message: e.message });
      }
    }

    if (raw.type === 'dex' && String(raw.chain || '').toLowerCase() === 'cardano') {
      try {
        const cardano = require('./onchain/cardano');
        let addrs = [];
        const mode = String(raw.track_by || 'stake');
        if (mode === 'stake' && raw.stake) {
          addrs = await cardano.getStakeAddresses(raw.stake);
        } else if (Array.isArray(raw.addresses)) {
          addrs = raw.addresses;
        }
        const pos = await cardano.getBalances(addrs);
        const items = [];
        for (const p of pos) {
          const qty = Number(p.qty || 0);
          if (qty > 0) items.push({ source: 'dex', chain: 'cardano', symbol: p.symbol, qty });
        }
        return res.json({ items });
      } catch (e) {
        const code = e && e.code === 'cardano_missing_blockfrost_key' ? 400 : 200;
        const payload = { items: [], error: 'fetch_failed', message: e.message };
        if (code === 400) payload.hint = 'Set BLOCKFROST_PROJECT_ID in environment.';
        return res.status(code).json(payload);
      }
    }

    return res.json({ items: [] });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

if (NO_LISTEN) {
  console.log('NO_LISTEN active: skipping HTTP listen.');
  console.log(`REF_FIAT=${REF_FIAT}; PULL_INTERVAL_MS=${INTERVAL_MS}`);
  // In NO_LISTEN mode, avoid starting the scheduler (which may require network).
  process.exit(0);
}

const server = app.listen(PORT, BIND_ADDR, () => {
  // For simplicity, display localhost URL for users even if binding to a different interface.
  console.log(`HTX Pi Monitor listening on http://localhost:${PORT}`);
  console.log(`REF_FIAT=${REF_FIAT}; PULL_INTERVAL_MS=${INTERVAL_MS}`);
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
