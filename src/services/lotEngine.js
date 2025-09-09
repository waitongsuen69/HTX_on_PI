// Pure functions for LOFO reconciliation

function cloneLots(byAsset) {
  const out = {};
  for (const [asset, arr] of Object.entries(byAsset || {})) {
    out[asset] = arr.map((l) => ({ ...l }));
  }
  return out;
}

function normalizeAndSort(byAsset) {
  const out = {};
  for (const [asset, arr] of Object.entries(byAsset || {})) {
    const lots = arr.map((l) => ({
      id: String(l.id || ''),
      action: String(l.action),
      asset: String(l.asset || asset),
      qty: Number(l.qty),
      unit_cost_usd: l.unit_cost_usd === null || l.unit_cost_usd === '' || l.unit_cost_usd === undefined ? null : Number(l.unit_cost_usd),
      ts: String(l.ts),
      note: l.note ? String(l.note) : '',
    }));
    lots.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    out[asset] = lots;
  }
  return out;
}

function validateLots(byAsset) {
  const errors = [];
  for (const [asset, arr] of Object.entries(byAsset || {})) {
    for (const l of arr) {
      if (!l.ts || isNaN(Date.parse(l.ts))) errors.push(`asset=${asset} id=${l.id}: invalid date`);
      if (!['buy','sell','deposit','withdraw'].includes(l.action)) errors.push(`asset=${asset} id=${l.id}: invalid action`);
      if (typeof l.qty !== 'number' || !isFinite(l.qty) || l.qty === 0) errors.push(`asset=${asset} id=${l.id}: qty must be non-zero number`);
      if (l.action === 'buy' || l.action === 'deposit') {
        if (l.qty < 0) errors.push(`asset=${asset} id=${l.id}: qty must be positive for ${l.action}`);
      } else if (l.action === 'sell' || l.action === 'withdraw') {
        if (l.qty > 0) errors.push(`asset=${asset} id=${l.id}: qty must be negative for ${l.action}`);
      }
      if (l.action === 'buy' && (l.unit_cost_usd === null || !isFinite(l.unit_cost_usd))) errors.push(`asset=${asset} id=${l.id}: unit_cost_usd required for buy`);
      if (l.action === 'withdraw' && l.unit_cost_usd !== null && l.unit_cost_usd !== undefined && l.unit_cost_usd !== '') errors.push(`asset=${asset} id=${l.id}: unit_cost_usd must be empty for withdraw`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function reconcileLOFO(byAsset, priceByAsset) {
  const sorted = normalizeAndSort(byAsset);
  const result = {};
  const perAssetSummary = {};

  for (const [asset, lots] of Object.entries(sorted)) {
    // Build inventory of positive qty lots (buy/deposit)
    const inventory = [];
    const originalLots = lots.map((l) => ({ ...l }));
    for (const l of originalLots) {
      if (l.action === 'buy' || l.action === 'deposit') {
        inventory.push({ lot: l, remaining: l.qty, cost: l.unit_cost_usd === null ? Infinity : Number(l.unit_cost_usd) });
      }
    }

    // Helper to LOFO pickers (lowest cost first; deposits last as cost = Infinity)
    function pickAvailable(amountAbs) {
      const alloc = [];
      // sort inventory by cost ascending each time to respect dynamic remaining
      inventory.sort((a, b) => a.cost - b.cost || (a.lot.ts < b.lot.ts ? -1 : a.lot.ts > b.lot.ts ? 1 : (a.lot.id < b.lot.id ? -1 : 1)));
      let need = amountAbs;
      for (const inv of inventory) {
        if (need <= 0) break;
        if (inv.remaining <= 0) continue;
        const take = Math.min(inv.remaining, need);
        inv.remaining -= take;
        need -= take;
        alloc.push({ from: inv.lot, qty: take, cost: inv.cost });
      }
      return { alloc, unmet: need };
    }

    // Process sells/withdraws by chronological order (they are in sorted already)
    for (const l of originalLots) {
      if (l.action === 'sell') {
        const want = Math.abs(l.qty);
        const { alloc, unmet } = pickAvailable(want);
        if (unmet > 1e-12) {
          return { error: `Negative inventory for ${asset} on sell id=${l.id}`, lotsByAsset: sorted };
        }
      } else if (l.action === 'withdraw') {
        const want = Math.abs(l.qty);
        const { alloc, unmet } = pickAvailable(want);
        if (unmet > 1e-12) {
          return { error: `Negative inventory for ${asset} on withdraw id=${l.id}`, lotsByAsset: sorted };
        }
      }
    }

    // Remaining inventory is post-reconciliation
    const remainingLots = inventory.filter(x => x.remaining > 1e-12);
    const lotsOut = [];
    for (const inv of remainingLots) {
      lotsOut.push({ ...inv.lot, remaining: inv.remaining });
    }
    // For completeness, attach remaining to all positive lots (0 if consumed)
    const allOut = originalLots.map((l) => {
      if (l.action === 'buy' || l.action === 'deposit') {
        const found = remainingLots.find((inv) => inv.lot.id === l.id);
        return { ...l, remaining: found ? found.remaining : 0 };
      }
      return { ...l };
    });

    // Summary
    let totalQty = 0;
    let costQty = 0;
    let costSum = 0;
    for (const inv of remainingLots) {
      totalQty += inv.remaining;
      if (isFinite(inv.cost)) {
        costQty += inv.remaining;
        costSum += inv.remaining * inv.cost;
      }
    }
    const avgCost = costQty > 0 ? costSum / costQty : null;
    const price = priceByAsset && priceByAsset[asset];
    const unrealized = price != null && costQty > 0 ? (price - (avgCost || 0)) * costQty : (price != null ? 0 : null);

    result[asset] = allOut;
    perAssetSummary[asset] = {
      total_qty: totalQty,
      avg_cost_usd: avgCost,
      unrealized_pl_usd: unrealized,
      remaining_lots: remainingLots.length,
    };
  }

  return { lotsByAsset: result, perAssetSummary };
}

module.exports = {
  normalizeAndSort,
  validateLots,
  reconcileLOFO,
};

