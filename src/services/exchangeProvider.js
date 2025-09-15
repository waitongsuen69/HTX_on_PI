// Simple exchange provider wrapper around HTX helpers.
// Provides daily/intraday OHLCV candles and current price.
const { getKlines, getPrices } = require('../htx');

// Normalize base symbol to HTX pair with USDT (e.g., BTC -> btcusdt)
function toPair(base) {
  return String(base || '').toLowerCase() + 'usdt';
}

async function fetchDailyCandles(base, { size = 120 } = {}) {
  const symbol = toPair(base);
  return getKlines({ symbol, period: '1day', size });
}

async function fetchIntradayCandles(base, { period = '60min', size = 1000 } = {}) {
  const symbol = toPair(base);
  return getKlines({ symbol, period, size });
}

async function fetchCurrentPrices(bases) {
  const map = await getPrices(bases);
  const out = {};
  for (const b of bases) {
    const rec = map[b] || {};
    out[b] = Number(rec.price || 0);
  }
  return out; // { BTC: 62000, ... }
}

module.exports = {
  fetchDailyCandles,
  fetchIntradayCandles,
  fetchCurrentPrices,
};

