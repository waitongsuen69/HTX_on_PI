const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const { createLotsStorage } = require('../storage/lotsStorage');
const { normalizeAndSort, validateLots, reconcileLOFO } = require('../services/lotEngine');
const { loadState } = require('../state');
const { getMatchResults } = require('../htx');

const upload = multer();
const router = express.Router();
const store = createLotsStorage();

function getPricesFromState() {
  try {
    const st = loadState();
    const last = st.history && st.history[st.history.length - 1];
    if (!last || !last.positions) return null;
    const map = {};
    for (const p of last.positions) map[p.symbol] = p.price;
    return map;
  } catch (_) { return null; }
}

function buildResponse(state) {
  const prices = getPricesFromState();
  const { lotsByAsset, perAssetSummary } = reconcileLOFO(state.byAsset, prices || undefined);
  const assets = Object.keys(lotsByAsset).sort().map((asset) => ({
    asset,
    summary: perAssetSummary[asset] || { total_qty: 0, avg_cost_usd: null, unrealized_pl_usd: null, remaining_lots: 0 },
    lots: lotsByAsset[asset].map(({ id, action, qty, unit_cost_usd, ts, note }) => ({ id, action, qty, unit_cost_usd, ts, note })),
  }));
  return {
    meta: { strategy: 'LOFO', last_id: state.meta.last_id, updated_at: state.meta.updated_at, backend: store.backend },
    assets,
  };
}

router.get('/', (req, res) => {
  const st = store.loadAll();
  const response = buildResponse(st);
  res.json(response);
});

function assignIdIfNeeded(state, lot) {
  if (!lot.id) {
    const idNum = state.meta.last_id + 1;
    state.meta.last_id = idNum;
    lot.id = String(idNum).padStart(6, '0');
  }
}

function mergeInto(state, lot) {
  if (!state.byAsset[lot.asset]) state.byAsset[lot.asset] = [];
  state.byAsset[lot.asset].push(lot);
}

router.post('/', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const lot = {
      id: '',
      action: String(body.action),
      asset: String(body.asset),
      qty: Number(body.qty),
      unit_cost_usd: body.unit_cost_usd === null || body.unit_cost_usd === '' || body.unit_cost_usd === undefined ? null : Number(body.unit_cost_usd),
      ts: String(body.date || body.ts),
      note: body.note || '',
    };
    const st = store.loadAll();
    assignIdIfNeeded(st, lot);
    mergeInto(st, lot);
    const norm = normalizeAndSort(st.byAsset);
    const v = validateLots(norm);
    if (!v.ok) return res.status(400).json({ error: 'invalid', details: v.errors });
    const recon = reconcileLOFO(norm);
    if (recon.error) return res.status(422).json({ error: 'reconciliation_failed', message: recon.error });
    st.byAsset = norm;
    await store.saveAll(st);
    const resp = buildResponse(st);
    const asset = resp.assets.find(a => a.asset === lot.asset);
    return res.status(201).json({ lot, summary: asset ? asset.summary : null });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

function findLot(st, id) {
  for (const [asset, arr] of Object.entries(st.byAsset)) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return { asset, index: i };
    }
  }
  return null;
}

function lotRemainingMap(byAsset) {
  const { lotsByAsset } = reconcileLOFO(byAsset);
  const map = {};
  for (const arr of Object.values(lotsByAsset)) {
    for (const l of arr) {
      if (l.action === 'buy' || l.action === 'deposit') map[l.id] = l.remaining || 0;
    }
  }
  return map;
}

router.put('/:id', express.json(), async (req, res) => {
  try {
    const id = String(req.params.id);
    const st = store.loadAll();
    const pos = findLot(st, id);
    if (!pos) return res.status(404).json({ error: 'not_found' });
    const rem = lotRemainingMap(st.byAsset);
    const original = st.byAsset[pos.asset][pos.index];
    const consumed = (original.action === 'buy' || original.action === 'deposit') && (rem[original.id] || 0) < original.qty - 1e-12;
    if (consumed) return res.status(409).json({ error: 'consumed_lot' });
    const body = req.body || {};
    // Allowed fields: date, qty, unit_cost_usd, note
    if (body.date) original.ts = String(body.date);
    if (body.qty != null) original.qty = Number(body.qty);
    if (body.unit_cost_usd !== undefined) original.unit_cost_usd = body.unit_cost_usd === null || body.unit_cost_usd === '' ? null : Number(body.unit_cost_usd);
    if (body.note !== undefined) original.note = String(body.note);
    const norm = normalizeAndSort(st.byAsset);
    const v = validateLots(norm);
    if (!v.ok) return res.status(400).json({ error: 'invalid', details: v.errors });
    const recon = reconcileLOFO(norm);
    if (recon.error) return res.status(422).json({ error: 'reconciliation_failed', message: recon.error });
    st.byAsset = norm;
    await store.saveAll(st);
    const resp = buildResponse(st);
    const asset = resp.assets.find(a => a.asset === pos.asset);
    res.json({ lot: original, summary: asset ? asset.summary : null });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const st = store.loadAll();
    const pos = findLot(st, id);
    if (!pos) return res.status(404).json({ error: 'not_found' });
    const rem = lotRemainingMap(st.byAsset);
    const original = st.byAsset[pos.asset][pos.index];
    const consumed = (original.action === 'buy' || original.action === 'deposit') && (rem[original.id] || 0) < original.qty - 1e-12;
    if (consumed) return res.status(409).json({ error: 'consumed_lot' });
    st.byAsset[pos.asset].splice(pos.index, 1);
    const norm = normalizeAndSort(st.byAsset);
    const recon = reconcileLOFO(norm);
    if (recon.error) return res.status(422).json({ error: 'reconciliation_failed', message: recon.error });
    st.byAsset = norm;
    await store.saveAll(st);
    res.status(204).end();
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

function parseIncomingCSV(buffer) {
  const text = buffer.toString('utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    const err = parsed.errors[0];
    throw new Error(`CSV parse error at row ${err.row}: ${err.message}`);
  }
  return parsed.data.map((r) => ({
    id: r.id || '',
    action: String(r.action),
    asset: String(r.asset),
    qty: Number(r.qty),
    unit_cost_usd: r.unit_cost_usd === '' ? null : Number(r.unit_cost_usd),
    ts: String(r.date),
    note: r.note || '',
  }));
}

router.post('/import', upload.single('file'), express.json(), async (req, res) => {
  try {
    const skipOnConflict = String(req.query.skipOnConflict || '').toLowerCase() === 'true';
    const st = store.loadAll();
    const existingIds = new Set(Object.values(st.byAsset).flat().map(l => l.id));

    let incoming = [];
    if (req.file && req.file.buffer) {
      incoming = parseIncomingCSV(req.file.buffer);
    } else if (req.is('application/json')) {
      const body = req.body || {};
      if (!Array.isArray(body.lots)) return res.status(400).json({ error: 'invalid', message: 'Expected lots array' });
      incoming = body.lots.map((x) => ({
        id: x.id || '', action: String(x.action), asset: String(x.asset), qty: Number(x.qty), unit_cost_usd: x.unit_cost_usd == null ? null : Number(x.unit_cost_usd), ts: String(x.ts || x.date), note: x.note || '',
      }));
    } else {
      return res.status(400).json({ error: 'invalid', message: 'Provide multipart file or JSON {lots:[]}' });
    }

    let imported = 0, skipped = 0;
    for (const lot of incoming) {
      if (lot.id && existingIds.has(lot.id)) {
        if (skipOnConflict) { skipped++; continue; }
        return res.status(409).json({ error: 'id_conflict', id: lot.id });
      }
      if (!lot.id) {
        st.meta.last_id += 1;
        lot.id = String(st.meta.last_id).padStart(6, '0');
      }
      if (!st.byAsset[lot.asset]) st.byAsset[lot.asset] = [];
      st.byAsset[lot.asset].push(lot);
      existingIds.add(lot.id);
      imported++;
    }

    const norm = normalizeAndSort(st.byAsset);
    const v = validateLots(norm);
    if (!v.ok) return res.status(400).json({ error: 'invalid', details: v.errors });
    const recon = reconcileLOFO(norm);
    if (recon.error) return res.status(422).json({ error: 'reconciliation_failed', message: recon.error });
    st.byAsset = norm;
    await store.saveAll(st);
    res.json({ imported, skipped, new_last_id: st.meta.last_id, warnings: [] });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

router.get('/export', (req, res) => {
  const st = store.loadAll();
  const format = String(req.query.format || 'csv').toLowerCase();
  if (format === 'json') {
    res.type('application/json').attachment('cost_basis_lots.json');
    res.send(JSON.stringify(st, null, 2));
  } else {
    // Build CSV
    const rows = [];
    for (const [asset, arr] of Object.entries(st.byAsset || {})) {
      for (const l of arr) rows.push({ id: l.id || '', date: l.ts, asset, action: l.action, qty: l.qty, unit_cost_usd: l.unit_cost_usd ?? '', note: l.note || '' });
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));
    const csv = Papa.unparse(rows, { columns: ['id','date','asset','action','qty','unit_cost_usd','note'] });
    res.type('text/csv').attachment('cost_basis_lots.csv');
    res.send(csv);
  }
});

module.exports = router;

// --- Trade sync route ---
// POST /api/lots/sync-trades?days=120
// For assets in current state snapshot, fetch match results from last N days in 48h windows,
// and create missing lots for USDT-quoted pairs.
async function syncTradesCore({ days = 120, sseEmit }) {
  const now = Date.now();
  const from = now - Math.max(1, Math.min(120, Number(days))) * 24 * 3600 * 1000;
  const windowMs = 48 * 3600 * 1000;
  const prices = getPricesFromState();
  const st = store.loadAll();
  const seenNotes = new Set();
  for (const arr of Object.values(st.byAsset)) {
    for (const l of arr) if (l.note && l.note.includes('trade#')) seenNotes.add(l.note);
  }
  const latest = loadState();
  const last = latest.history && latest.history[latest.history.length - 1];
  const assets = last && last.positions ? last.positions.map(p => String(p.symbol).toUpperCase()) : [];
  const symbols = assets.filter(Boolean);

  // Current inventory by asset from reconciliation
  const invStart = {};
  try {
    const recon0 = reconcileLOFO(st.byAsset);
    if (recon0 && recon0.perAssetSummary) {
      for (const [asset, sum] of Object.entries(recon0.perAssetSummary)) invStart[asset] = Number(sum.total_qty || 0);
    }
  } catch (_) {}

  const stepsPerAsset = Math.ceil((now - from) / windowMs);
  const totalSteps = Math.max(1, symbols.length * stepsPerAsset);
  let step = 0;
  function emitProgress(msg) {
    if (sseEmit) {
      const pct = Math.min(100, Math.round((step / totalSteps) * 100));
      sseEmit('progress', { percent: pct, message: msg });
    }
  }

  let created = 0, skipped = 0;
  const warnings = [];

  for (const asset of symbols) {
    const sym = (asset + 'usdt').toLowerCase();
    let inv = Number(invStart[asset] || 0);
    for (let end = now; end > from; end -= windowMs) {
      const start = Math.max(from, end - windowMs + 1);
      emitProgress(`Fetching ${sym} ${new Date(start).toISOString()}..${new Date(end).toISOString()}`);
      let rows = [];
      try {
        // Ensure window does not exceed 48h per HTX constraints
        if (end - start > windowMs) {
          warnings.push(`window-too-large ${sym} ${new Date(start).toISOString()}..${new Date(end).toISOString()} ${(end-start)/3600000}h`);
          step++; emitProgress(`Window too large for ${sym}`);
          continue;
        }
        rows = await getMatchResults({ symbol: sym, startTime: start, endTime: end });
      } catch (e) {
        const errMsg = `Error ${sym}: ${e.message} (start=${start}, end=${end}, startISO=${new Date(start).toISOString()}, endISO=${new Date(end).toISOString()})`;
        warnings.push(errMsg);
        step++; emitProgress(errMsg);
        continue;
      }
      // sort ascending by created-at
      rows.sort((a,b) => Number(a['created-at']||a['created_at']||a.ts||0) - Number(b['created-at']||b['created_at']||b.ts||0));
      for (const r of rows) {
        const tradeId = String(r.id || r['trade-id'] || r['match-id'] || '');
        if (tradeId && seenNotes.has(`trade#${tradeId}`)) continue;
        const createdAt = Number(r['created-at'] || r['created_at'] || r.ts || 0);
        const ts = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
        const type = String(r.type || '').toLowerCase();
        const side = type.startsWith('buy') ? 'buy' : type.startsWith('sell') ? 'sell' : null;
        if (!side) continue;
        const amount = Number(r['filled-amount'] || r.amount || r.qty || 0);
        const price = Number(r.price || (prices && prices[asset] && prices[asset].price) || NaN);
        if (!isFinite(amount) || amount <= 0) continue;
        if (!isFinite(price)) { warnings.push(`skip non-USDT or missing price for ${asset} trade ${tradeId}`); continue; }
        if (side === 'sell' && inv < amount - 1e-12) {
          skipped++; warnings.push(`skip sell ${asset} trade#${tradeId} (insufficient inventory in last ${Math.round((now-from)/86400000)}d)`);
          continue;
        }
        const lot = { id: '', action: side, asset, qty: side === 'buy' ? amount : -amount, unit_cost_usd: price, ts, note: tradeId ? `trade#${tradeId}` : '' };
        if (!st.byAsset[asset]) st.byAsset[asset] = [];
        st.byAsset[asset].push(lot);
        if (lot.note) seenNotes.add(lot.note);
        inv += (side === 'buy') ? amount : -amount;
        created++;
      }
      step++; emitProgress(`Processed ${sym} window, created=${created}, skipped=${skipped}`);
    }
  }

  const norm = normalizeAndSort(st.byAsset);
  const v = validateLots(norm);
  if (!v.ok) return { created, skipped, warnings: [...warnings, ...v.errors], saved: false };
  const recon = reconcileLOFO(norm);
  if (recon.error) return { created, skipped, warnings: [...warnings, recon.error], saved: false };
  st.byAsset = norm;
  await store.saveAll(st);
  return { created, skipped, warnings, saved: true };
}

router.post('/sync-trades', async (req, res) => {
  try {
    const days = Number(req.query.days || 120);
    const out = await syncTradesCore({ days });
    // Never 422 here; return details for UI
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

router.get('/sync-trades-stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const emit = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const days = Number(req.query.days || 120);
    const out = await syncTradesCore({ days, sseEmit: emit });
    emit('done', out);
  } catch (e) {
    emit('error', { message: e.message });
  } finally {
    res.end();
  }
});
