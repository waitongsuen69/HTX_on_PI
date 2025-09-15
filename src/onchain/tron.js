const TronWebPkg = require('tronweb');
const TronWebCtor = (TronWebPkg && (TronWebPkg.TronWeb || TronWebPkg.default || TronWebPkg)) || null;

function createClient() {
  if (typeof TronWebCtor !== 'function') {
    throw new Error('tronweb_not_available');
  }
  const fullHost = process.env.TRON_FULLNODE || 'https://api.trongrid.io';
  const key = process.env.TRON_API_KEY || '';
  const headers = key ? { 'TRON-PRO-API-KEY': key } : {};
  return new TronWebCtor({ fullHost, headers });
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
    const c = await withTimeout(tron.contract().at(contractAddr), 10000);
    // Try base58 address first
    let res = await withTimeout(c.balanceOf(address).call(), 10000);
    let val = decodeTronValue(res);
    if (!val) {
      // Fallback to hex address encoding
      try {
        const hex = tron.address.toHex(address);
        res = await withTimeout(c.balanceOf(hex).call(), 10000);
        val = decodeTronValue(res);
      } catch (_) { /* ignore */ }
    }
    if (!val) {
      // Low-level fallback via triggerSmartContract
      try {
        const hex = tron.address.toHex(address);
        const ret = await withTimeout(
          tron.transactionBuilder.triggerSmartContract(
            contractAddr,
            'balanceOf(address)',
            {},
            [{ type: 'address', value: hex }]
          ),
          10000
        );
        if (ret && Array.isArray(ret.constant_result) && ret.constant_result[0]) {
          val = parseInt(ret.constant_result[0], 16) || 0;
        }
      } catch (_) { /* ignore */ }
    }
    const denom = Math.pow(10, Number(decimals || 0));
    return denom > 0 ? (Number(val || 0) / denom) : 0;
  } catch (e) { return 0; }
}

async function getBalances(addresses, allowlistTokens = []) {
  const tron = createClient();
  const out = [];
  for (const addr of addresses) {
    // Try a single account query to get TRX (incl. staked) and TRC20 balances
    let accountMap = {};
    let availSun = 0;
    let stakedSun = 0;
    try {
      const acct = await withTimeout(tron.trx.getAccount(addr), 10000);
      // Available TRX
      if (Number.isFinite(Number(acct && acct.balance))) availSun = Number(acct.balance || 0);
      // Staked TRX (frozen V2)
      if (Array.isArray(acct && acct.frozenV2)) {
        for (const f of acct.frozenV2) stakedSun += Number(f && f.amount || 0);
      }
      // Older fields
      const ar = acct && acct.account_resource;
      if (ar && ar.frozen_balance_for_energy && Number.isFinite(Number(ar.frozen_balance_for_energy.frozen_balance))) {
        stakedSun += Number(ar.frozen_balance_for_energy.frozen_balance || 0);
      }
      if (Array.isArray(acct && acct.frozen)) {
        for (const f of acct.frozen) stakedSun += Number(f && f.frozen_balance || 0);
      }
      const trc20 = Array.isArray(acct && acct.trc20) ? acct.trc20 : [];
      for (const entry of trc20) {
        if (entry && typeof entry === 'object') {
          for (const [k, v] of Object.entries(entry)) {
            const key = String(k).toLowerCase();
            // values often come as strings
            const raw = typeof v === 'string' ? v : (v && v._hex ? parseInt(v._hex, 16) : Number(v));
            const val = Number(raw || 0);
            if (!accountMap[key]) accountMap[key] = 0;
            accountMap[key] += val;
          }
        }
      }
    } catch (_) { /* ignore */ }

    // If account call failed, fall back to simple TRX balance
    if (!availSun && !stakedSun) {
      const trx = await getTrxBalance(tron, addr);
      availSun = Math.round(trx * 1e6);
    }

    const totalTrx = (availSun + stakedSun) / 1e6;
    if (totalTrx > 0) out.push({ source: 'dex', chain: 'tron', address: addr, symbol: 'TRX', qty: totalTrx });

    for (const tok of allowlistTokens) {
      const contractLc = String(tok.contract || '').toLowerCase();
      let qty = 0;
      if (accountMap[contractLc] != null) {
        const denom = Math.pow(10, Number(tok.decimals || 0));
        qty = denom > 0 ? (Number(accountMap[contractLc] || 0) / denom) : 0;
      } else {
        // Fallback to direct contract call
        qty = await getTrc20Balance(tron, addr, tok.contract, tok.decimals);
      }
      if (qty > 0) out.push({ source: 'dex', chain: 'tron', address: addr, symbol: String(tok.symbol || '').toUpperCase(), qty });
    }
  }
  return out;
}

module.exports = { createClient, getTrxBalance, getTrc20Balance, getBalances };
