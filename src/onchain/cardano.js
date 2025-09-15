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
      // reference exported function to ease testing via jest.spyOn
      utxos = await module.exports.getAddressUTxOs(addr);
    } catch (e) {
      // Skip address on error
      continue;
    }
    const sums = {}; // symbol -> qty
    for (const u of (utxos || [])) {
      const amounts = Array.isArray(u.amount) ? u.amount : [];
      for (const a of amounts) {
        const unit = a.unit;
        const q = Number(a.quantity || 0);
        const meta = parseAssetUnit(unit);
        if (meta.kind === 'ada') {
          addQty(sums, 'ADA', q / 1e6);
        } else if (meta.kind === 'native') {
          const sym = `cardano:${meta.policy}.${meta.assetHex}`;
          addQty(sums, sym, q); // leave raw quantity; display as unpriced
        }
      }
    }
    for (const [sym, qty] of Object.entries(sums)) {
      if (qty > 0) out.push({ source: 'dex', chain: 'cardano', address: addr, symbol: sym, qty: Number(qty) });
    }
  }
  return out;
}

module.exports = {
  getStakeAddresses,
  getAddressUTxOs,
  getBalances,
  _parseAssetUnit: parseAssetUnit,
};
