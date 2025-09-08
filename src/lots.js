const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./state');

const LOTS_FILE = path.join(DATA_DIR, 'cost_basis_lots.json');

function ensureLotsFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOTS_FILE)) {
    writeJsonAtomic(LOTS_FILE, { meta: { last_id: 0 } });
  }
}

function loadLots() {
  ensureLotsFile();
  try {
    const raw = fs.readFileSync(LOTS_FILE, 'utf8');
    const json = JSON.parse(raw || '{}');
    if (!json.meta) json.meta = { last_id: 0 };
    return json;
  } catch (e) {
    return { meta: { last_id: 0 } };
  }
}

function saveLotsAtomic(lotsState) {
  ensureLotsFile();
  writeJsonAtomic(LOTS_FILE, lotsState);
}

function nextId(state) {
  if (!state.meta) state.meta = { last_id: 0 };
  state.meta.last_id = (state.meta.last_id || 0) + 1;
  return String(state.meta.last_id).padStart(6, '0');
}

function sortLotsForLOFO(lots) {
  // null unit_cost treated as +Infinity so deducted last
  return [...lots].sort((a, b) => {
    const ac = a.unit_cost == null ? Infinity : a.unit_cost;
    const bc = b.unit_cost == null ? Infinity : b.unit_cost;
    if (ac === bc) return 0;
    return ac < bc ? -1 : 1;
  });
}

function deductLOFO(lots, qtyToDeduct) {
  if (qtyToDeduct <= 0) return lots;
  const ordered = sortLotsForLOFO(lots);
  let remaining = qtyToDeduct;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    lot.qty -= take;
    remaining -= take;
  }
  const cleaned = ordered.filter(l => (l.qty || 0) > 1e-12);
  // preserve original order by reconstructing from ordered into new array? For persistence we can keep as ordered
  return cleaned;
}

function applyEntry(symbol, entry, lotsState) {
  const state = lotsState || loadLots();
  if (!state[symbol]) state[symbol] = { lots: [] };
  const lots = state[symbol].lots || [];
  const { action, qty, unit_cost, ts } = entry;
  const id = nextId(state);
  const base = { id, qty: Number(qty), unit_cost: unit_cost == null ? null : Number(unit_cost), ts };

  switch (action) {
    case 'buy':
    case 'deposit': {
      lots.push({ ...base, action });
      break;
    }
    case 'sell':
    case 'withdraw': {
      const newLots = deductLOFO(lots, Number(qty));
      state[symbol].lots = newLots;
      // We still record the event somewhere? For MVP, persistence of resulting lots is enough per spec.
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
  state[symbol].lots = state[symbol].lots || lots;
  return state;
}

function avgCostForSymbol(state, symbol) {
  const rec = state[symbol];
  if (!rec || !Array.isArray(rec.lots) || rec.lots.length === 0) return { avg_cost: 0, qty: 0 };
  let sumCost = 0;
  let sumQty = 0;
  for (const lot of rec.lots) {
    if (lot.unit_cost == null) continue; // ignore unknown cost
    const q = Number(lot.qty) || 0;
    const c = Number(lot.unit_cost) || 0;
    sumQty += q;
    sumCost += q * c;
  }
  const avg = sumQty > 0 ? sumCost / sumQty : 0;
  const totalQty = rec.lots.reduce((a, b) => a + (Number(b.qty) || 0), 0);
  return { avg_cost: avg, qty: totalQty };
}

module.exports = {
  LOTS_FILE,
  loadLots,
  saveLotsAtomic,
  nextId,
  applyEntry,
  deductLOFO,
  avgCostForSymbol,
};

