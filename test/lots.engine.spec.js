const { normalizeAndSort, validateLots, reconcileLOFO } = require('../src/services/lotEngine');

function lots(byAsset) { return byAsset; }

describe('LOFO engine', () => {
  test('lowest cost consumed first; deposits last', () => {
    const by = lots({ TRX: [
      { id:'000001', action:'buy', asset:'TRX', qty:100, unit_cost_usd:0.10, ts:'2025-01-01T00:00:00Z' },
      { id:'000002', action:'buy', asset:'TRX', qty:100, unit_cost_usd:0.08, ts:'2025-01-02T00:00:00Z' },
      { id:'000003', action:'deposit', asset:'TRX', qty:100, unit_cost_usd:null, ts:'2025-01-03T00:00:00Z' },
      { id:'000004', action:'sell', asset:'TRX', qty:-150, unit_cost_usd:null, ts:'2025-01-04T00:00:00Z' },
    ]});
    const v = validateLots(by); expect(v.ok).toBe(true);
    const r = reconcileLOFO(by);
    const rem = r.lotsByAsset.TRX.filter(l => l.action !== 'sell');
    const m = {}; rem.forEach(l => m[l.id]=l.remaining||0);
    expect(m['000002']).toBeCloseTo(0); // lowest cost fully consumed first
    expect(m['000001']).toBeCloseTo(50); // then next lowest
    expect(m['000003']).toBeCloseTo(100); // deposits last untouched
  });

  test('withdraw exceeding inventory invalid', () => {
    const by = lots({ BTC: [
      { id:'1', action:'buy', asset:'BTC', qty:1, unit_cost_usd:10000, ts:'2025-01-01T00:00:00Z' },
      { id:'2', action:'withdraw', asset:'BTC', qty:-2, unit_cost_usd:null, ts:'2025-01-02T00:00:00Z' },
    ]});
    const r = reconcileLOFO(by);
    expect(r.error).toMatch(/Negative inventory/);
  });

  test('mixed assets isolated', () => {
    const by = lots({ BTC: [ { id:'1', action:'buy', asset:'BTC', qty:1, unit_cost_usd:10000, ts:'2025-01-01' } ],
                      ETH: [ { id:'2', action:'sell', asset:'ETH', qty:-1, unit_cost_usd:null, ts:'2025-01-01' } ] });
    const r = reconcileLOFO(by);
    // ETH sell with no inventory triggers error, BTC untouched
    expect(r.error).toMatch(/ETH/);
  });

  test('unordered input sorted by ts,id', () => {
    const by = lots({ TRX: [
      { id:'b', action:'buy', asset:'TRX', qty:100, unit_cost_usd:0.2, ts:'2025-01-02' },
      { id:'a', action:'buy', asset:'TRX', qty:100, unit_cost_usd:0.1, ts:'2025-01-01' },
      { id:'c', action:'sell', asset:'TRX', qty:-50, unit_cost_usd:null, ts:'2025-01-03' },
    ]});
    const r = reconcileLOFO(by);
    const m = {}; r.lotsByAsset.TRX.filter(l=>l.action!=='sell').forEach(l=>m[l.id]=l.remaining||0);
    expect(m['a']).toBeCloseTo(50);
    expect(m['b']).toBeCloseTo(100);
  });
});

