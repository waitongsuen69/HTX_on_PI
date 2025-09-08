const crypto = require('crypto');
const axios = require('axios');

// HTX/Huobi REST endpoints
// Note: Domains have varied historically. Using api.huobi.pro as a common default; allow override via env.
const BASE_HOST = process.env.HTX_API_HOST || 'api.huobi.pro';
const BASE_URL = `https://${BASE_HOST}`;

const ACCESS_KEY = process.env.HTX_ACCESS_KEY || '';
const SECRET_KEY = process.env.HTX_SECRET_KEY || '';
const ACCOUNT_ID = process.env.HTX_ACCOUNT_ID || '';

const HTTP_TIMEOUT = 10_000;
const DEBUG = String(process.env.DEBUG || '').toLowerCase() === '1' || String(process.env.DEBUG || '').toLowerCase() === 'true';

function hmacSignSHA256(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

function utcISOStringNoMs(date = new Date()) {
  // Huobi expects UTC time formatted as yyyy-MM-dd'T'HH:mm:ss (no milliseconds, no timezone suffix)
  // Example: 2017-05-11T15:19:30
  // toISOString() returns UTC like 2025-09-04T12:34:56.789Z
  // Slice to seconds and drop the trailing 'Z'.
  return date.toISOString().slice(0, 19);
}

function buildSignedQuery(method, host, path, params, secret) {
  const pairs = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const meta = [method.toUpperCase(), host, path, pairs].join('\n');
  const sig = hmacSignSHA256(meta, secret);
  return `${pairs}&Signature=${encodeURIComponent(sig)}`;
}

async function privateGet(path, extraParams = {}) {
  if (!ACCESS_KEY || !SECRET_KEY) throw new Error('HTX keys not set');
  const params = {
    AccessKeyId: ACCESS_KEY,
    SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2',
    Timestamp: utcISOStringNoMs(),
    ...extraParams,
  };
  const query = buildSignedQuery('GET', BASE_HOST, path, params, SECRET_KEY);
  const url = `${BASE_URL}${path}?${query}`;
  const res = await axios.get(url, { timeout: HTTP_TIMEOUT });
  if (res.data && res.data.status === 'ok') return res.data.data;
  // Provide more context from HTX error payloads
  const body = res && res.data ? res.data : {};
  const status = body.status || 'error';
  const code = body['err-code'] || body.code || '';
  const msg = body['err-msg'] || body.message || '';
  const extra = [code, msg].filter(Boolean).join(' - ');
  throw new Error(`HTX private error: ${status}${extra ? ` ${extra}` : ''}`);
}

async function publicGet(path, params = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await axios.get(url, { params, timeout: HTTP_TIMEOUT });
  return res.data;
}

// List accounts to identify spot and earning/investment accounts
async function listAccounts() {
  // GET /v1/account/accounts -> [{ id, type, state, subtype? }]
  const data = await privateGet('/v1/account/accounts', {});
  return Array.isArray(data) ? data : [];
}

async function fetchBalancesForAccount(accId) {
  const path = `/v1/account/accounts/${accId}/balance`;
  const data = await privateGet(path, {});
  const byCurrency = {};
  const accType = String((data && data.type) || '').toLowerCase();
  // Spot uses 'trade'; deposit-earning uses 'lending'. Include both for safety on earning.
  const allowedTypes = accType === 'deposit-earning' ? new Set(['lending', 'trade']) : new Set(['trade']);
  if (data && Array.isArray(data.list)) {
    for (const item of data.list) {
      if (!allowedTypes.has(String(item.type || '').toLowerCase())) continue;
      const cur = String(item.currency || '').toUpperCase();
      const bal = Number(item.balance || 0);
      if (!cur) continue;
      if (!byCurrency[cur]) byCurrency[cur] = { free: 0 };
      byCurrency[cur].free += bal;
    }
  }
  return byCurrency;
}

// Debug helper: fetch the raw balance payload for an account
async function fetchAccountBalanceRaw(accId) {
  const path = `/v1/account/accounts/${accId}/balance`;
  return privateGet(path, {});
}

function mergeBalances(target, add) {
  for (const [cur, v] of Object.entries(add || {})) {
    if (!target[cur]) target[cur] = { free: 0 };
    target[cur].free += Number(v.free || 0);
  }
  return target;
}

// Get balances by summing spot and earning accounts (simplified)
async function getBalances() {
  const accounts = await listAccounts();

  // Collect account IDs we care about: spot + earning variants
  const wantedTypes = new Set(['spot', 'deposit-earning']);
  const idSet = new Set();

  // Allow explicit override for spot via env
  if (ACCOUNT_ID) idSet.add(String(ACCOUNT_ID));

  for (const a of accounts) {
    const t = String(a.type || '').toLowerCase();
    if (wantedTypes.has(t)) idSet.add(String(a.id));
  }

  // Ensure a spot account exists in scope (or env override provided)
  const hasSpot = ACCOUNT_ID ? true : accounts.some(a => String(a.type || '').toLowerCase() === 'spot');
  if (!hasSpot) throw new Error('HTX spot account id not found');

  const idsToFetch = Array.from(idSet);

  let merged = {};
  for (const id of idsToFetch) {
    const bal = await fetchBalancesForAccount(id);
    merged = mergeBalances(merged, bal);
    if (DEBUG) {
      console.log(
        `HTX account ${id} balances:\n${JSON.stringify(bal, null, 2)}\nmerged:\n${JSON.stringify(merged, null, 2)}`
      );
    }
  }
  return merged; // { BTC: { free }, ... }
}

// Get tickers: we map needed symbols to USDT last price and 24h change
async function getPrices(symbols) {
  // Use market tickers endpoint to reduce calls
  // GET /market/tickers returns array with symbol, close, open, etc.
  const data = await publicGet('/market/tickers');
  const out = {};
  if (data && data.status === 'ok' && Array.isArray(data.data)) {
    const need = new Set(symbols.map(s => s.toUpperCase()));
    for (const t of data.data) {
      const sym = String(t.symbol || '').toUpperCase(); // e.g., BTCUSDT
      if (!sym.endsWith('USDT')) continue;
      const base = sym.replace('USDT', '');
      if (!need.has(base)) continue;
      const last = Number(t.close);
      const open = Number(t.open);
      const dayPct = open ? ((last / open - 1) * 100) : null;
      out[base] = { price: last, day_pct: dayPct };
    }
  }
  // Stablecoin fallbacks for USD ref: ensure USDT/USDC valued
  const stableFallback = { USDT: 1, USDC: 1 };
  for (const s of symbols.map(s => s.toUpperCase())) {
    if (stableFallback[s] && !out[s]) out[s] = { price: stableFallback[s], day_pct: 0 };
  }
  return out; // { BTC: { price, day_pct }, ... }
}

module.exports = {
  getBalances,
  getPrices,
  // exposed for debugging/account discovery
  listAccounts,
  // debug exports
  fetchBalancesForAccount,
  fetchAccountBalanceRaw,
};
