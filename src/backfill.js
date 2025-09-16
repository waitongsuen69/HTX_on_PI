const { getBalances, getKlines } = require('./htx');
const { loadState, addSnapshot, saveStateAtomic } = require('./state');
const { computeSnapshot } = require('./calc');

function dayPctFromBar(bar) {
  if (!bar) return null;
  const o = Number(bar.open);
  const c = Number(bar.close);
  if (!o || !isFinite(o) || !isFinite(c)) return null;
  return ((c / o - 1) * 100);
}

async function backfillHistoryIfNeeded({ days = 180, refFiat = 'USD', minUsdIgnore = 10, logger = console } = {}) {
  const state = loadState();
  if (Array.isArray(state.history) && state.history.length > 0) {
    return false; // nothing to backfill
  }
  try {
    logger.log(`[backfill] history empty; backfilling last ${days} days...`);
    const balances = await getBalances();
    const symbols = Object.keys(balances || {});
    if (symbols.length === 0) {
      logger.warn('[backfill] no balances found; skipping backfill');
      return false;
    }

    // Fetch daily klines for each symbol once
    const barsBySymbol = {};
    for (const base of symbols) {
      try {
        const symbol = (base + 'USDT').toLowerCase();
        const rows = await getKlines({ symbol, period: '1day', size: Math.max(days + 1, 7) });
        barsBySymbol[base] = rows;
      } catch (e) {
        logger.warn(`[backfill] kline fetch failed for ${base}: ${e.message}`);
        barsBySymbol[base] = [];
      }
    }

    // Build per-day snapshots from oldest to newest
    // Choose common timeline from bars; use the most complete symbol's bars
    const timeline = [];
    for (const arr of Object.values(barsBySymbol)) {
      for (const r of arr) timeline.push(r.ts);
    }
    const uniqTs = Array.from(new Set(timeline)).sort((a, b) => a - b);
    const lastDays = uniqTs.slice(-days);

    for (const ts of lastDays) {
      // Construct prices map using close for that date and day_pct from that bar
      const prices = {};
      for (const base of symbols) {
        const arr = barsBySymbol[base] || [];
        const bar = arr.find(b => b.ts === ts);
        if (!bar) continue;
        prices[base] = { price: Number(bar.close), day_pct: dayPctFromBar(bar) };
      }
      const snap = computeSnapshot({ balances, prices, refFiat, minUsdIgnore });
      // Override snapshot time to bar time (seconds)
      snap.time = Math.floor(ts / 1000);
      addSnapshot(state, snap);
    }

    saveStateAtomic(state);
    logger.log(`[backfill] added ${state.history.length} snapshots`);
    return true;
  } catch (e) {
    logger.warn('[backfill] failed:', e.message);
    return false;
  }
}

const { getPrices } = require('./htx');

async function captureCurrentSnapshot({ refFiat = 'USD', minUsdIgnore = 10, logger = console } = {}) {
  try {
    const balances = await getBalances();
    const symbols = Object.keys(balances || {});
    const prices = await getPrices(symbols);
    const snap = computeSnapshot({ balances, prices, refFiat, minUsdIgnore });
    const state = loadState();
    addSnapshot(state, snap);
    saveStateAtomic(state);
    logger.log('[capture] added current snapshot');
    return true;
  } catch (e) {
    logger.warn('[capture] failed:', e.message);
    return false;
  }
}

module.exports = { backfillHistoryIfNeeded, captureCurrentSnapshot };
