// Historical price utilities: compute baseline price for a UTC day using
// either daily close or VWAP (intraday-preferred, daily fallback).
const Ex = require('./exchangeProvider');

function startOfUtcDay(tsMs) {
  const d = new Date(tsMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function endOfUtcDay(tsMs) {
  return startOfUtcDay(tsMs) + 24 * 60 * 60 * 1000 - 1;
}

function pctChange(now, baseline) {
  const n = Number(now || 0);
  const b = Number(baseline || 0);
  if (!(n > 0) || !(b > 0)) return null;
  return (n / b - 1) * 100;
}

// Compute Close price for the UTC day: use 1d candle close for that day.
async function computeCloseForDay(base, utcDayMs) {
  const rows = await Ex.fetchDailyCandles(base, { size: 200 });
  const dayStart = startOfUtcDay(utcDayMs);
  const dayEnd = endOfUtcDay(utcDayMs);
  // HTX daily candles have ts at the bar start (00:00 UTC) for that day.
  const row = rows.find(r => r.ts >= dayStart && r.ts <= dayEnd);
  return row ? Number(row.close) : null;
}

function typicalPrice(candle) {
  return (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3;
}

// Compute VWAP for the UTC day.
// Prefer intraday candles (60m). If none, fallback to daily OHLCV typical price.
async function computeVWAPForDay(base, utcDayMs) {
  const dayStart = startOfUtcDay(utcDayMs);
  const dayEnd = endOfUtcDay(utcDayMs);

  const intra = await Ex.fetchIntradayCandles(base, { period: '60min', size: 1000 });
  const daySlices = intra.filter(r => r.ts >= dayStart && r.ts <= dayEnd);
  if (daySlices.length > 0) {
    let sumPV = 0;
    let sumV = 0;
    for (const r of daySlices) {
      const price = typicalPrice(r);
      const vol = Number(r.vol || 0);
      if (vol > 0 && price > 0) { sumPV += price * vol; sumV += vol; }
    }
    if (sumV > 0) return sumPV / sumV;
  }
  // Fallback: daily typical price (H+L+C)/3
  const daily = await Ex.fetchDailyCandles(base, { size: 200 });
  const row = daily.find(r => r.ts >= dayStart && r.ts <= dayEnd);
  return row ? typicalPrice(row) : null;
}

// mode: 'close' | 'vwap'
async function computeBaselinePrice(base, utcDayMs, mode = 'close') {
  const m = String(mode || 'close').toLowerCase();
  if (m === 'vwap') return computeVWAPForDay(base, utcDayMs);
  return computeCloseForDay(base, utcDayMs);
}

module.exports = {
  computeBaselinePrice,
  pctChange,
  // export for testing
  _startOfUtcDay: startOfUtcDay,
  _endOfUtcDay: endOfUtcDay,
  _typicalPrice: typicalPrice,
};

