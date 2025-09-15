const { avgCostForSymbol } = require('./lots');

function computeSnapshot({ balances, prices, lotsState, refFiat = 'USD', minUsdIgnore = 10, alwaysIncludeSymbols = [] }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const positions = [];
  let totalValue = 0;
  let weightedDayNumer = 0;

  const symbols = Object.keys(balances || {});
  const includeSet = new Set((alwaysIncludeSymbols || []).map(s => String(s || '').toUpperCase()));

  for (const sym of symbols) {
    const free = Number(balances[sym]?.free || 0);
    if (free <= 0) continue;
    const pr = prices[sym];
    const price = pr?.price ?? null;
    const mustInclude = includeSet.has(String(sym).toUpperCase());
    // If no price and not required, skip. If mustInclude, include with price=null and value 0.
    if (price == null && !mustInclude) continue;
    const day_pct = pr?.day_pct ?? null;
    const value = price != null ? (free * price) : 0;

    const { avg_cost, qty } = avgCostForSymbol(lotsState || {}, sym);
    const pnl_pct = avg_cost > 0 && price != null ? ((price / avg_cost - 1) * 100) : null;

    const reconciled = Math.abs((qty || 0) - free) <= 1e-8; // within tolerance

    // Ignore positions worth less than minUsdIgnore, unless mustInclude
    if (!mustInclude && value < Number(minUsdIgnore || 0)) continue;

    positions.push({
      symbol: sym,
      free,
      price,
      value,
      day_pct,
      pnl_pct,
      unreconciled: !reconciled,
    });

    totalValue += value;
    if (day_pct != null) weightedDayNumer += value * (day_pct / 100);
  }

  const total_change_24h_pct = totalValue > 0 ? (weightedDayNumer / totalValue) * 100 : 0;

  const snapshot = {
    time: nowSec,
    ref_fiat: refFiat,
    total_value_usd: totalValue,
    total_change_24h_pct,
    positions: positions.sort((a, b) => b.value - a.value),
  };
  return snapshot;
}

module.exports = { computeSnapshot };
