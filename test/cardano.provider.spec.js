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

  test('balances from UTXOs (ADA + native)', async () => {
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
    const res = await cardano.getBalances([addr]);
    spy.mockRestore();
    // Expect two items: ADA and one native token
    const ada = res.find(x => x.symbol === 'ADA');
    const tok = res.find(x => String(x.symbol).startsWith('cardano:'));
    expect(ada).toBeTruthy();
    expect(tok).toBeTruthy();
    expect(ada.qty).toBeCloseTo(4.5, 6);
    expect(tok.qty).toBe(42);
  });
});

