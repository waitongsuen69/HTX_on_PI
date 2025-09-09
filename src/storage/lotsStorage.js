const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const { atomicWriteJSON, atomicWriteText, withLock } = require('../utils/atomicFile');
const { DATA_DIR } = require('../state');

const BACKEND = (process.env.STORAGE_BACKEND || 'JSON').toUpperCase();

// Types
// Action = 'buy' | 'sell' | 'deposit' | 'withdraw'

function nowIso() { return new Date().toISOString(); }

function zeroPad6(n) { return String(n).padStart(6, '0'); }

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Common helpers
function normalizeLot(raw) {
  return {
    id: String(raw.id),
    action: String(raw.action),
    asset: String(raw.asset),
    qty: typeof raw.qty === 'string' ? Number(raw.qty) : Number(raw.qty),
    unit_cost_usd: raw.unit_cost_usd === null || raw.unit_cost_usd === '' || raw.unit_cost_usd === undefined ? null : Number(raw.unit_cost_usd),
    ts: String(raw.ts || raw.date),
    note: raw.note ? String(raw.note) : '',
  };
}

function groupByAsset(lots) {
  const by = {};
  for (const lot of lots) {
    if (!by[lot.asset]) by[lot.asset] = [];
    by[lot.asset].push(lot);
  }
  return by;
}

// JSON backend
function createJSONBackend() {
  const file = path.join(DATA_DIR, 'cost_basis_lots.json');
  function loadAll() {
    ensureDir();
    if (!fs.existsSync(file)) {
      return { meta: { last_id: 0, strategy: 'LOFO', updated_at: nowIso() }, byAsset: {} };
    }
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Support both new format (byAsset) and legacy format (top-level symbol -> {lots:[]})
      let byAsset = {};
      if (json.byAsset) {
        const lots = [];
        for (const [asset, arr] of Object.entries(json.byAsset || {})) {
          for (const l of arr) lots.push({ ...l, asset });
        }
        byAsset = groupByAsset(lots.map(normalizeLot));
      } else {
        // legacy: { BTC: { lots: [...] }, ETH: { lots: [...] }, meta: {...} }
        const lots = [];
        for (const [asset, rec] of Object.entries(json)) {
          if (asset === 'meta') continue;
          const arr = (rec && Array.isArray(rec.lots)) ? rec.lots : [];
          for (const l of arr) {
            lots.push(normalizeLot({
              id: l.id || '', action: l.action, asset, qty: l.qty, unit_cost_usd: l.unit_cost ?? l.unit_cost_usd ?? null, date: l.ts, note: l.note || '',
            }));
          }
        }
        byAsset = groupByAsset(lots);
      }
      return {
        meta: {
          last_id: Number((json.meta && json.meta.last_id) || 0),
          strategy: 'LOFO',
          updated_at: (json.meta && json.meta.updated_at) || nowIso(),
        },
        byAsset,
      };
    } catch (_) {
      return { meta: { last_id: 0, strategy: 'LOFO', updated_at: nowIso() }, byAsset: {} };
    }
  }
  async function saveAll(state) {
    state.meta = state.meta || { last_id: 0, strategy: 'LOFO', updated_at: nowIso() };
    state.meta.updated_at = nowIso();
    // Also write legacy top-level shape for compatibility with existing modules
    const legacy = { meta: { last_id: state.meta.last_id } };
    for (const [asset, arr] of Object.entries(state.byAsset || {})) {
      legacy[asset] = { lots: arr.map((l) => ({ id: l.id, action: l.action, qty: l.qty, unit_cost: l.unit_cost_usd, ts: l.ts, note: l.note || '' })) };
    }
    const combined = { ...legacy, meta: { ...state.meta }, byAsset: state.byAsset };
    await withLock(() => atomicWriteJSON(file, combined));
  }
  async function nextId() {
    const st = loadAll();
    const id = st.meta.last_id + 1;
    st.meta.last_id = id;
    await saveAll(st);
    return zeroPad6(id);
  }
  return { loadAll, saveAll, nextId, backend: 'JSON' };
}

// CSV backend
function createCSVBackend() {
  const lotsFile = path.join(DATA_DIR, 'cost_basis_lots.csv');
  const metaFile = path.join(DATA_DIR, 'cost_basis_meta.json');

  function parseCsv(text) {
    const res = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (res.errors && res.errors.length) {
      const err = res.errors[0];
      throw new Error(`CSV parse error at row ${err.row}: ${err.message}`);
    }
    return res.data;
  }

  function readMeta() {
    if (!fs.existsSync(metaFile)) return { last_id: 0, strategy: 'LOFO', updated_at: nowIso() };
    try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { return { last_id: 0, strategy: 'LOFO', updated_at: nowIso() }; }
  }

  function loadAll() {
    ensureDir();
    const meta = readMeta();
    if (!fs.existsSync(lotsFile)) return { meta, byAsset: {} };
    const text = fs.readFileSync(lotsFile, 'utf8');
    const rows = parseCsv(text);
    const lots = rows.map((r) => normalizeLot({
      id: r.id || '',
      action: r.action,
      asset: r.asset,
      qty: r.qty,
      unit_cost_usd: r.unit_cost_usd === '' ? null : r.unit_cost_usd,
      date: r.date,
      note: r.note || '',
    }));
    return { meta, byAsset: groupByAsset(lots) };
  }

  async function saveAll(state) {
    state.meta = state.meta || { last_id: 0, strategy: 'LOFO', updated_at: nowIso() };
    state.meta.updated_at = nowIso();
    // Flatten to rows
    const rows = [];
    for (const [asset, arr] of Object.entries(state.byAsset || {})) {
      for (const l of arr) {
        rows.push({
          id: l.id || '',
          date: l.ts,
          asset,
          action: l.action,
          qty: String(l.qty),
          unit_cost_usd: l.unit_cost_usd === null || l.unit_cost_usd === undefined ? '' : String(l.unit_cost_usd),
          note: l.note || '',
        });
      }
    }
    // Deterministic order by ts asc then id asc
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    const csv = Papa.unparse(rows, { columns: ['id','date','asset','action','qty','unit_cost_usd','note'] });
    await withLock(async () => {
      await atomicWriteText(lotsFile, csv);
      await atomicWriteJSON(metaFile, state.meta);
    });
  }

  async function nextId() {
    const meta = readMeta();
    const id = (meta.last_id || 0) + 1;
    meta.last_id = id;
    meta.updated_at = nowIso();
    await withLock(() => atomicWriteJSON(metaFile, meta));
    return zeroPad6(id);
  }

  return { loadAll, saveAll, nextId, backend: 'CSV' };
}

function createLotsStorage() {
  return BACKEND === 'CSV' ? createCSVBackend() : createJSONBackend();
}

module.exports = { createLotsStorage };
