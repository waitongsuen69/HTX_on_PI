const TronWeb = require('tronweb');

function createClient() {
  const fullHost = process.env.TRON_FULLNODE || 'https://api.trongrid.io';
  const key = process.env.TRON_API_KEY || '';
  const headers = key ? { 'TRON-PRO-API-KEY': key } : {};
  return new TronWeb({ fullHost, headers });
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

async function getTrc20Balance(tron, address, contractAddr, decimals) {
  try {
    const c = await withTimeout(tron.contract().at(contractAddr), 10000);
    const res = await withTimeout(c.balanceOf(address).call(), 10000);
    const val = typeof res === 'object' && res._hex ? parseInt(res._hex, 16) : Number(res);
    const denom = Math.pow(10, Number(decimals || 0));
    return denom > 0 ? (Number(val || 0) / denom) : 0;
  } catch (_) { return 0; }
}

async function getBalances(addresses, allowlistTokens = []) {
  const tron = createClient();
  const out = [];
  for (const addr of addresses) {
    // TRX
    const trx = await getTrxBalance(tron, addr);
    if (trx > 0) out.push({ source: 'dex', chain: 'tron', address: addr, symbol: 'TRX', qty: trx });
    // TRC20 sequential per address
    for (const tok of allowlistTokens) {
      const qty = await getTrc20Balance(tron, addr, tok.contract, tok.decimals);
      if (qty > 0) out.push({ source: 'dex', chain: 'tron', address: addr, symbol: tok.symbol.toUpperCase(), qty });
    }
  }
  return out;
}

module.exports = { createClient, getTrxBalance, getTrc20Balance, getBalances };

