const axios = require('axios');
const Accounts = require('../accounts');

const BF_BASE = 'https://cardano-mainnet.blockfrost.io/api/v0';

async function requireBlockfrost() {
  const cfg = await Accounts.getCardanoConfig();
  if ((cfg.provider || 'blockfrost') !== 'blockfrost') throw new Error('cardano_unsupported_provider');
  if (!cfg.project_id) {
    const err = new Error('cardano_missing_blockfrost_key');
    err.code = 'cardano_missing_blockfrost_key';
    throw err;
  }
}

async function bf() {
  await requireBlockfrost();
  const cfg = await Accounts.getCardanoConfig();
  const inst = axios.create({
    baseURL: BF_BASE,
    timeout: 15000,
    headers: { project_id: cfg.project_id },
  });
  return inst;
}

async function getStakeAddresses(stake) {
  await requireBlockfrost();
  const s = String(stake || '').trim();
  if (!s || !s.startsWith('stake1')) throw new Error('invalid_stake');
  const cli = await bf();
  // Paginate if needed (simple first page with generous count)
  const res = await cli.get(`/accounts/${encodeURIComponent(s)}/addresses`, { params: { count: 100 } });
  const arr = Array.isArray(res.data) ? res.data : [];
  return arr.map((r) => r.address).filter(Boolean);
}

async function getAddressUTxOs(addr) {
  await requireBlockfrost();
  const a = String(addr || '').trim();
  if (!a || !a.startsWith('addr1')) throw new Error('invalid_address');
  const cli = await bf();
  const res = await cli.get(`/addresses/${encodeURIComponent(a)}/utxos`, { params: { count: 100 } });
  const arr = Array.isArray(res.data) ? res.data : [];
  return arr;
}

function parseAssetUnit(unit) {
  // Blockfrost uses "lovelace" for ADA, otherwise unit = policyId + assetHex
  if (unit === 'lovelace') return { kind: 'ada' };
  const u = String(unit || '');
  // policy id is 56 hex chars
  const policy = u.slice(0, 56);
  const assetHex = u.slice(56);
  return { kind: 'native', policy, assetHex };
}

function addQty(map, key, delta) {
  if (!map[key]) map[key] = 0;
  map[key] += delta;
}

async function getBalances(addresses) {
  // Returns array like TRON provider: [{ source:'dex', chain:'cardano', address, symbol, qty }]
  const out = [];
  const addrs = Array.from(new Set((addresses || []).map(a => String(a || '').trim()).filter(a => a)));
  if (addrs.length === 0) return out;
  for (const addr of addrs) {
    let utxos;
    try {
      utxos = await module.exports.getAddressUTxOs(addr);
    } catch (e) {
      continue; // skip address on error
    }
    // 1) Aggregate by unit (lovelace or policy+assetHex)
    const totals = new Map(); // unit -> BigInt
    for (const u of (utxos || [])) {
      const amounts = Array.isArray(u.amount) ? u.amount : [];
      for (const a of amounts) {
        const unit = String(a.unit || '');
        const qtyStr = String(a.quantity || '0');
        let cur = totals.get(unit) || 0n;
        try { cur += BigInt(qtyStr); } catch (_) { /* fallback */ cur += BigInt(Number(qtyStr || 0)); }
        totals.set(unit, cur);
      }
    }

    // 2) Resolve metadata for unique native units (concurrency-limited)
    const units = Array.from(totals.keys()).filter(u => u !== 'lovelace');
    const limit = pLimit(5);
    const metaMap = new Map();
    await Promise.all(units.map((u) => limit(async () => {
      const m = await module.exports.getAssetMeta(u);
      metaMap.set(u, m || null);
    })));

    // 3) Emit holdings for this address
    for (const [unit, qtyBI] of totals) {
      if (unit === 'lovelace') {
        const qty = Number(qtyBI) / 1e6;
        if (qty > 0) out.push({ source: 'dex', chain: 'cardano', address: addr, symbol: 'ADA', qty });
        continue;
      }
      const policyId = unit.slice(0, 56);
      const assetHex = unit.slice(56);
      const meta = metaMap.get(unit) || null;
      const symCore = chooseSymbol(meta, policyId, assetHex);
      const displaySymbol = symCore; // no chain prefix in symbol
      const dec = chooseDecimals(meta);
      let qty;
      if (dec == null) {
        qty = Number(qtyBI);
      } else {
        const denom = Math.pow(10, dec);
        qty = Number(qtyBI) / denom;
      }
      if (qty > 0) out.push({ source: 'dex', chain: 'cardano', address: addr, symbol: displaySymbol, qty, unpriced: true });
    }
  }
  return out;
}

module.exports = {
  getStakeAddresses,
  getAddressUTxOs,
  getBalances,
  getAssetMeta,
  _parseAssetUnit: parseAssetUnit,
};

// -------------------- Metadata helpers and cache --------------------

const assetMetaCache = new Map(); // unit -> { t, v }
const ASSET_META_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function getAssetMeta(unit) {
  const now = Date.now();
  const hit = assetMetaCache.get(unit);
  if (hit && (now - hit.t) < ASSET_META_TTL_MS) return hit.v;
  try {
    const cli = await bf();
    const res = await cli.get(`/assets/${encodeURIComponent(unit)}`);
    const meta = res && res.data ? res.data : null;
    assetMetaCache.set(unit, { t: now, v: meta });
    return meta;
  } catch (e) {
    // cache null for TTL window to avoid hammering
    assetMetaCache.set(unit, { t: now, v: null });
    return null;
  }
}

function hexToUtf8(hex) {
  try {
    if (!hex) return '';
    const buf = Buffer.from(hex, 'hex');
    const s = buf.toString('utf8');
    if (/[^\x20-\x7E]/.test(s)) return null; // non-printables
    return s;
  } catch (_) { return null; }
}

function chooseDecimals(meta) {
  const d = meta && meta.metadata && meta.metadata.decimals;
  return (typeof d === 'number' && d >= 0 && d <= 18) ? d : null;
}

function chooseSymbol(meta, policyId, assetHex) {
  const ticker = meta && meta.metadata && typeof meta.metadata.ticker === 'string' ? meta.metadata.ticker.trim() : '';
  const name = meta && meta.metadata && meta.metadata.name != null ? String(meta.metadata.name).trim() : '';
  const decoded = hexToUtf8(assetHex) || assetHex;
  if (ticker) return ticker;
  if (name) return name;
  if (decoded) return decoded;
  return `${policyId}.${assetHex}`;
}

function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then((v) => { resolve(v); }).catch(reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
