const cardano = require('../src/onchain/cardano');

describe('Cardano provider (unit)', () => {
  test('parse asset unit', () => {
    const a = cardano._parseAssetUnit('lovelace');
    expect(a.kind).toBe('ada');
    const unit = '0123456789abcdef0123456789abcdef0123456789abcdef01234567deadbeef';
    const b = cardano._parseAssetUnit(unit);
    expect(b.kind).toBe('native');
    expect(b.policy).toHaveLength(56);
    expect(b.assetHex).toBe('deadbeef');
  });

  test('balances from UTXOs (ADA + native, no meta)', async () => {
    const addr = 'addr1qxyexampleaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const spy = jest.spyOn(cardano, 'getAddressUTxOs').mockResolvedValue([
      {
        tx_hash: 'tx1',
        amount: [
          { unit: 'lovelace', quantity: '3000000' },
          { unit: '0123456789abcdef0123456789abcdef0123456789abcdef01234567deadbeef', quantity: '42' },
        ],
      },
      {
        tx_hash: 'tx2',
        amount: [ { unit: 'lovelace', quantity: '1500000' } ],
      },
    ]);
    const metaSpy = jest.spyOn(cardano, 'getAssetMeta').mockResolvedValue(null);
    const res = await cardano.getBalances([addr]);
    spy.mockRestore();
    metaSpy.mockRestore();
    // Expect two items: ADA and one native token
    const ada = res.find(x => x.symbol === 'ADA');
    const tok = res.find(x => String(x.symbol).toUpperCase() !== 'ADA');
    expect(ada).toBeTruthy();
    expect(tok).toBeTruthy();
    expect(ada.qty).toBeCloseTo(4.5, 6);
    expect(tok.qty).toBe(42);
  });

  test('balances use asset metadata (ticker + decimals)', async () => {
    const addr = 'addr1qexample';
    const unit = '0123456789abcdef0123456789abcdef0123456789abcdef01234567534e454b'; // ... + '534E454B' (SNEK)
    const spy = jest.spyOn(cardano, 'getAddressUTxOs').mockResolvedValue([
      { tx_hash: 't', amount: [ { unit, quantity: '17427000000' } ] },
    ]);
    const meta = {
      asset: unit,
      policy_id: unit.slice(0,56),
      asset_name: '534E454B',
      metadata: { ticker: 'SNEK', decimals: 6 }
    };
    const metaSpy = jest.spyOn(cardano, 'getAssetMeta').mockResolvedValue(meta);
    const res = await cardano.getBalances([addr]);
    spy.mockRestore();
    metaSpy.mockRestore();
    const tok = res.find(x => String(x.symbol).toUpperCase() === 'SNEK');
    expect(tok).toBeTruthy();
    expect(tok.symbol).toBe('SNEK');
    expect(tok.qty).toBeCloseTo(17427.0, 6);
  });
});
