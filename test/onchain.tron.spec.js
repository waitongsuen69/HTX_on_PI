const Accounts = require('../src/accounts');
const tron = require('../src/onchain/tron');

jest.setTimeout(30000);

describe('TRON on-chain balances (read-all-assets)', () => {
  test('returns TRX and multiple TRC20 assets for configured address', async () => {
    const addrs = (await Accounts.getTronAddresses()).map((x) => x.address);
    if (addrs.length === 0) {
      console.warn('[tron test] no TRON addresses configured; skipping');
      return;
    }
    const res = await tron.getBalances(addrs);
    expect(Array.isArray(res)).toBe(true);
    // Must include TRX
    const hasTrx = res.some((x) => x.symbol === 'TRX');
    expect(hasTrx).toBe(true);
    // Expect at least 3 non-TRX assets for the known address with holdings
    const nonTrx = res.filter((x) => x.symbol !== 'TRX');
    expect(nonTrx.length).toBeGreaterThanOrEqual(3);
    // Quantities should be positive numbers
    for (const it of res) {
      expect(typeof it.qty).toBe('number');
      expect(it.qty).toBeGreaterThan(0);
    }
  });
});

