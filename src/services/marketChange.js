const { getKlines } = require('../htx');

// Simple in-memory cache for kline-derived changes
const cache = new Map(); // key: base symbol, value: { at: ms, data }
const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function computeChangesFromKlines(base) {
  const now = Date.now();
  const hit = cache.get(base);
  if (hit && (now - hit.at) < TTL_MS) return hit.data;
  if (base === 'USDT' || base === 'USDC') {
    const data = { change_1d_pct: 0, change_7d_pct: 0, change_30d_pct: 0 };
    cache.set(base, { at: now, data });
    return data;
  }
  try {
    const rows = await getKlines({ symbol: (base + 'USDT').toLowerCase(), period: '1day', size: 90 });
    const n = rows.length;
    if (n < 2) {
      const data = { change_1d_pct: null, change_7d_pct: null, change_30d_pct: null };
      cache.set(base, { at: now, data });
      return data;
    }
    const last = rows[n - 1];
    const prev = rows[n - 2];
    const lastClose = Number(last.close);
    const prevClose = Number(prev.close);
    const dayMs = 24 * 60 * 60 * 1000;
    const target7 = last.ts - 7 * dayMs;
    const target30 = last.ts - 30 * dayMs;
    function closeAtOrBefore(tsTarget) {
      for (let i = n - 1; i >= 0; i--) if (rows[i].ts <= tsTarget) return Number(rows[i].close);
      return null;
    }
    function closeByIndex(daysAgo) {
      const idx = n - (daysAgo + 1);
      return (idx >= 0 && rows[idx]) ? Number(rows[idx].close) : null;
    }
    let close7 = closeAtOrBefore(target7);
    let close30 = closeAtOrBefore(target30);
    if (close7 == null) close7 = closeByIndex(7) ?? (rows[0] ? Number(rows[0].close) : null);
    if (close30 == null) close30 = closeByIndex(30) ?? (rows[0] ? Number(rows[0].close) : null);
    const change_1d_pct = prevClose > 0 ? ((lastClose / prevClose - 1) * 100) : null;
    const change_7d_pct = close7 > 0 ? ((lastClose / close7 - 1) * 100) : null;
    const change_30d_pct = close30 > 0 ? ((lastClose / close30 - 1) * 100) : null;
    const data = { change_1d_pct, change_7d_pct, change_30d_pct };
    cache.set(base, { at: now, data });
    return data;
  } catch (_) {
    const data = { change_1d_pct: null, change_7d_pct: null, change_30d_pct: null };
    cache.set(base, { at: now, data });
    return data;
  }
}

module.exports = { computeChangesFromKlines };

