const TronWebPkg = require('tronweb');
const Accounts = require('../accounts');
const axios = require('axios');
const TronWebCtor = (TronWebPkg && (TronWebPkg.TronWeb || TronWebPkg.default || TronWebPkg)) || null;

function createClient({ apiKey, fullHost } = {}) {
  if (typeof TronWebCtor !== 'function') {
    throw new Error('tronweb_not_available');
  }
  const host = fullHost || process.env.TRON_FULLNODE || 'https://api.trongrid.io';
  const key = apiKey || '';
  const headers = key ? { 'TRON-PRO-API-KEY': key } : {};
  return new TronWebCtor({ fullHost: host, headers });
}

function withTimeout(promise, ms = 10000) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tron_timeout')), ms); });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

async function getTrxBalance(tron, address) {
  try {
    const raw = await withTimeout(tron.trx.getBalance(address), 10000);
    return Number(raw || 0) / 1e6;
  } catch (_) { return 0; }
}

function decodeTronValue(res) {
  if (res == null) return 0;
  if (typeof res === 'number') return res;
  if (typeof res === 'string') {
    const s = res.trim();
    if (!s) return 0;
    if (s.startsWith('0x') || s.startsWith('0X')) {
      try { return parseInt(s, 16); } catch (_) { return 0; }
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof res === 'object') {
    if (typeof res._hex === 'string') {
      try { return parseInt(res._hex, 16); } catch (_) { /* fallthrough */ }
    }
    if (typeof res.toString === 'function') {
      const s = res.toString();
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    if (Array.isArray(res.constant_result) && res.constant_result[0]) {
      try { return parseInt(res.constant_result[0], 16); } catch (_) { /* noop */ }
    }
  }
  return 0;
}

async function getTrc20Balance(tron, address, contractAddr, decimals) {
  try {
    // Normalize contract address to hex (TronWeb APIs are more reliable with hex)
    let contractHex = contractAddr;
    try {
      if (/^[Tt]/.test(String(contractAddr || ''))) contractHex = tron.address.toHex(contractAddr);
    } catch (_) { /* ignore */ }

    try { if (address) tron.setAddress(address); } catch (_) { /* ignore */ }
    const c = await withTimeout(tron.contract().at(contractHex), 10000);
    const dbg = (String(process.env.TRON_DEBUG || '').toLowerCase() === 'true' || String(process.env.TRON_DEBUG || '') === '1');
    if (dbg) console.log(`[tron] getTrc20Balance at ${contractHex} for ${address}`);
    // Try base58 address first
    let res = null;
    let val = 0;
    try {
      res = await withTimeout(c.balanceOf(address).call(), 10000);
      val = decodeTronValue(res);
      if (dbg) console.log(`[tron] balanceOf(base58) ->`, res, 'decoded=', val);
    } catch (e) {
      if (dbg) console.log('[tron] balanceOf(base58) error:', e && e.message ? e.message : String(e));
    }
    if (!val) {
      // Fallback to hex address encoding
      try {
        const hex = tron.address.toHex(address);
        res = await withTimeout(c.balanceOf(hex).call(), 10000);
        val = decodeTronValue(res);
        if (dbg) console.log(`[tron] balanceOf(hex) ->`, res, 'decoded=', val);
      } catch (e) {
        if (dbg) console.log('[tron] balanceOf(hex) error:', e && e.message ? e.message : String(e));
      }
    }
    if (!val) {
      // Low-level fallback via triggerSmartContract
      try {
        const hex = tron.address.toHex(address);
        const ret = await withTimeout(
          tron.transactionBuilder.triggerSmartContract(
            contractHex,
            'balanceOf(address)',
            {},
            [{ type: 'address', value: hex }],
            address
          ),
          10000
        );
        if (ret && Array.isArray(ret.constant_result) && ret.constant_result[0]) {
          val = parseInt(ret.constant_result[0], 16) || 0;
        }
        if (dbg) console.log(`[tron] triggerSmartContract ->`, ret, 'decoded=', val);
      } catch (e) { if (dbg) console.log('[tron] triggerSmartContract error:', e && e.message ? e.message : String(e)); }
    }
    const denom = Math.pow(10, Number(decimals || 0));
    return denom > 0 ? (Number(val || 0) / denom) : 0;
  } catch (e) { return 0; }
}

// Simple in-memory cache for TRC20 metadata by contract (hex or base58 lowercased)
const tokenMetaCache = new Map(); // key -> { symbol, decimals, ts }

function cacheMeta(contractHex, contractBase58, meta) {
  const m = { symbol: meta.symbol || '', decimals: Number.isFinite(Number(meta.decimals)) ? Number(meta.decimals) : null, ts: Date.now() };
  if (contractHex) tokenMetaCache.set(String(contractHex).toLowerCase(), m);
  if (contractBase58) tokenMetaCache.set(String(contractBase58).toLowerCase(), m);
  return m;
}

async function getTrc20Meta(tron, contractAddr) {
  const dbg = (String(process.env.TRON_DEBUG || '').toLowerCase() === 'true' || String(process.env.TRON_DEBUG || '') === '1');
  // Normalize both hex and base58
  let contractHex = contractAddr;
  let contractBase58 = contractAddr;
  try {
    if (/^[Tt]/.test(String(contractAddr || ''))) {
      contractHex = tron.address.toHex(contractAddr);
    } else if (/^(0x)?41/i.test(String(contractAddr || ''))) {
      contractBase58 = tron.address.fromHex(contractAddr);
    }
  } catch (_) { /* ignore */ }
  const keyHex = String(contractHex || '').replace(/^0x/i, '').toLowerCase();
  const key58 = String(contractBase58 || '').toLowerCase();
  if (tokenMetaCache.has(keyHex)) return tokenMetaCache.get(keyHex);
  if (tokenMetaCache.has(key58)) return tokenMetaCache.get(key58);

  // 1) Try Tronscan metadata (fast, includes decimals/symbol for many tokens)
  try {
    const base = 'https://apilist.tronscanapi.com';
    const url = `${base}/api/token_trc20?contract=${encodeURIComponent(contractBase58)}`;
    if (dbg) console.log('[tron] meta tronscan GET', url);
    const res = await withTimeout(axios.get(url, { timeout: 12000 }), 15000);
    const d = res && res.data;
    const arr = d && (d.trc20_tokens || d.tokens);
    if (Array.isArray(arr) && arr[0]) {
      const sym = String(arr[0].symbol || arr[0].symbolShow || '').trim();
      const dec = Number(arr[0].decimals);
      const meta = cacheMeta(keyHex, key58, { symbol: sym, decimals: dec });
      if (dbg) console.log('[tron] meta tronscan ok', contractBase58, sym, dec);
      return meta;
    }
  } catch (e) { if (dbg) console.log('[tron] meta tronscan err', e && e.message); }

  // 2) Fallback to on-chain contract calls
  let symbol = '';
  let decimals = null;
  try {
    if (dbg) console.log('[tron] meta onchain at', contractHex);
    const c = await withTimeout(tron.contract().at(contractHex), 10000);
    try {
      const dec = await withTimeout(c.decimals().call(), 8000);
      decimals = Number(decodeTronValue(dec) || 0);
    } catch (_) { decimals = null; }
    try {
      const sym = await withTimeout(c.symbol().call(), 8000);
      if (sym == null) symbol = '';
      else if (typeof sym === 'string') symbol = sym;
      else if (sym._hex) {
        try { const buf = Buffer.from(sym._hex.replace(/^0x/i, ''), 'hex'); symbol = buf.toString('utf8').replace(/\u0000+$/g, '').trim(); } catch (_) { symbol = ''; }
      } else if (typeof sym.toString === 'function') {
        symbol = String(sym.toString());
      }
    } catch (_) { symbol = ''; }
  } catch (_) { /* ignore */ }
  return cacheMeta(keyHex, key58, { symbol, decimals });
}


async function fetchAccountAssetsViaTronGrid({ fullnode, apiKey }, address) {
  const dbg = (String(process.env.TRON_DEBUG || '').toLowerCase() === 'true' || String(process.env.TRON_DEBUG || '') === '1');
  try {
    const base = (fullnode || 'https://api.trongrid.io').replace(/\/$/, '');
    const url = `${base}/v1/accounts/${encodeURIComponent(address)}`;
    const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
    if (dbg) console.log('[tron] GET', url);
    const res = await withTimeout(axios.get(url, { headers, timeout: 12000 }), 15000);
    const dataArr = res && res.data && Array.isArray(res.data.data) ? res.data.data : [];
    const acct = dataArr[0] || {};
    const out = { trxSun: Number(acct.balance || 0), trc20: [] };
  const trc20 = Array.isArray(acct.trc20) ? acct.trc20 : [];
  for (const t of trc20) {
    if (!t || typeof t !== 'object') continue;
    if (t.contract_address || t.tokenId) {
      // Shape with metadata
      const contract = String(t.contract_address || t.tokenId || '').trim();
      if (!contract) continue;
      const symbol = String(t.symbol || t.tokenAbbr || '').trim();
      const decimals = Number.isFinite(Number(t.decimals)) ? Number(t.decimals) : null;
      const raw = t.balance;
      const intVal = Number(typeof raw === 'string' ? raw : Number(raw || 0));
      out.trc20.push({ contract, symbol, decimals, intVal });
      continue;
    }
    // Map shape: { "Txxxx": "12345" }
    for (const [k, v] of Object.entries(t)) {
      const contract = String(k || '').trim();
      if (!contract) continue;
      const raw = v;
      const intVal = Number(typeof raw === 'string' ? raw : Number(raw || 0));
      out.trc20.push({ contract, symbol: '', decimals: null, intVal });
    }
  }
    if (dbg) console.log('[tron] grid parsed trc20', out.trc20.length);
    return out;
  } catch (e) { if (dbg) console.log('[tron] grid error', e && e.message); return null; }
}

async function getBalances(addresses) {
  const cfg = await Accounts.getTronConfig();
  const tron = createClient({ apiKey: cfg.api_key, fullHost: cfg.fullnode });
  const out = [];
  for (const addr of addresses) {
    // Prefer TronGrid account API for TRC20 list; use TronWeb for TRX and as fallback
    let accountMap = {};
    let metaByContract = {};
    let availSun = 0;
    let stakedSun = 0;

    // 1) Try TronGrid for balances and TRC20 inventory
    const dbg = (String(process.env.TRON_DEBUG || '').toLowerCase() === 'true' || String(process.env.TRON_DEBUG || '') === '1');
    const grid = await fetchAccountAssetsViaTronGrid({ fullnode: cfg.fullnode, apiKey: cfg.api_key }, addr);
    if (grid) {
      if (dbg) console.log('[tron] grid.trc20 count', Array.isArray(grid.trc20) ? grid.trc20.length : 0);
      availSun = Number(grid.trxSun || 0);
      for (const t of grid.trc20) {
        let key = String(t.contract || '').trim();
        if (!key) continue;
        // Normalize to hex (41...)
        try { if (/^[Tt]/.test(key)) key = tron.address.toHex(key); } catch (_) { /* ignore */ }
        // strip 0x if present and lowercase
        key = key.replace(/^0x/i, '').toLowerCase();
        if (!accountMap[key]) accountMap[key] = 0;
        accountMap[key] += Number(t.intVal || 0);
        metaByContract[key] = { symbol: String(t.symbol || '').toUpperCase(), decimals: (t.decimals != null ? Number(t.decimals) : null) };
      }
      if (dbg) console.log('[tron] accountMap size after grid', Object.keys(accountMap).length);
    }

    // 2) Enrich TRX with staked amounts using TronWeb
    try {
      const acct = await withTimeout(tron.trx.getAccount(addr), 10000);
      if (!availSun && Number.isFinite(Number(acct && acct.balance))) availSun = Number(acct.balance || 0);
      if (Array.isArray(acct && acct.frozenV2)) {
        for (const f of acct.frozenV2) stakedSun += Number(f && f.amount || 0);
      }
      const ar = acct && acct.account_resource;
      if (ar && ar.frozen_balance_for_energy && Number.isFinite(Number(ar.frozen_balance_for_energy.frozen_balance))) {
        stakedSun += Number(ar.frozen_balance_for_energy.frozen_balance || 0);
      }
      if (Array.isArray(acct && acct.frozen)) {
        for (const f of acct.frozen) stakedSun += Number(f && f.frozen_balance || 0);
      }
      // If TronGrid didn't give TRC20, try reading acct.trc20 as a fallback
      if (Object.keys(accountMap).length === 0) {
        const trc20 = Array.isArray(acct && acct.trc20) ? acct.trc20 : [];
        for (const entry of trc20) {
          if (!entry || typeof entry !== 'object') continue;
          if (entry.contract_address) {
            let key = String(entry.contract_address || '');
            try { if (/^[Tt]/.test(key)) key = tron.address.toHex(key); } catch (_) {}
            key = key.replace(/^0x/i, '').toLowerCase();
            const raw = entry.balance;
            const val = Number(typeof raw === 'string' ? raw : Number(raw || 0));
            if (!accountMap[key]) accountMap[key] = 0;
            accountMap[key] += val;
            if (entry.symbol || entry.decimals != null) {
              metaByContract[key] = { symbol: String(entry.symbol || '').toUpperCase(), decimals: Number(entry.decimals != null ? entry.decimals : NaN) };
            }
            continue;
          }
          const pairs = Object.entries(entry);
          for (const [k, v] of pairs) {
            let maybeAddr = String(k || '');
            // Normalize base58 to hex
            try { if (/^[Tt]/.test(maybeAddr)) maybeAddr = tron.address.toHex(maybeAddr); } catch (_) {}
            maybeAddr = maybeAddr.replace(/^0x/i, '').toLowerCase();
            if (!/^41/i.test(maybeAddr)) continue;
            const raw = typeof v === 'string' ? v : (v && v._hex ? parseInt(v._hex, 16) : Number(v));
            const val = Number(raw || 0);
            if (!accountMap[maybeAddr]) accountMap[maybeAddr] = 0;
            accountMap[maybeAddr] += val;
          }
        }
      }
    } catch (_) { /* ignore */ }

    // 3) Fallback TRX if still zero
    if (!availSun && !stakedSun) {
      const trx = await getTrxBalance(tron, addr);
      availSun = Math.round(trx * 1e6);
    }

    const totalTrx = (availSun + stakedSun) / 1e6;
    if (totalTrx > 0) out.push({ source: 'dex', chain: 'tron', address: addr, symbol: 'TRX', qty: totalTrx });

    // Emit all discovered TRC20 balances for this address
    for (const [contractHex, rawVal] of Object.entries(accountMap)) {
      let symbol = (metaByContract[contractHex] && metaByContract[contractHex].symbol) || '';
      let decimals = (metaByContract[contractHex] && metaByContract[contractHex].decimals);
      if (dbg) console.log('[tron] pre-meta', contractHex, 'symbol', symbol, 'dec', decimals);
      if (!Number.isFinite(decimals) || decimals == null) {
        try {
          const meta = await getTrc20Meta(tron, contractHex);
          if (meta && meta.symbol) symbol = meta.symbol.toUpperCase();
          if (meta && Number.isFinite(meta.decimals)) decimals = Number(meta.decimals);
        } catch (_) { /* ignore */ }
      }
      // Fallback symbol if missing
      if (!symbol) {
        symbol = `TKN_${contractHex.slice(0, 5).toUpperCase()}`;
      }
      const denom = Math.pow(10, Number.isFinite(decimals) ? Number(decimals) : 6);
      const qty = denom > 0 ? (Number(rawVal || 0) / denom) : 0;
      if (qty > 0) {
        if (dbg) console.log('[tron] emit', contractHex, symbol, qty);
        out.push({ source: 'dex', chain: 'tron', address: addr, symbol: String(symbol || '').toUpperCase(), qty });
      }
    }
  }
  return out;
}

module.exports = { createClient, getTrxBalance, getTrc20Balance, getBalances };
