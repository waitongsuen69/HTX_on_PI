const hp = require('../src/services/historicalPrice');

jest.mock('../src/services/exchangeProvider', () => ({
  fetchDailyCandles: jest.fn(),
  fetchIntradayCandles: jest.fn(),
  fetchCurrentPrices: jest.fn(),
}));

const Ex = require('../src/services/exchangeProvider');

describe('historicalPrice', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('pctChange correctness', () => {
    expect(hp.pctChange(110, 100)).toBeCloseTo(10);
    expect(hp.pctChange(90, 100)).toBeCloseTo(-10);
    expect(hp.pctChange(0, 100)).toBeNull();
    expect(hp.pctChange(100, 0)).toBeNull();
  });

  test('computeBaselinePrice close vs vwap (intraday)', async () => {
    const day = Date.UTC(2025, 0, 15); // Jan 15, 2025 UTC
    // Daily candle row for the day (will be used for close mode)
    Ex.fetchDailyCandles.mockResolvedValueOnce([
      { ts: day, open: 90, high: 110, low: 80, close: 100, vol: 1000 },
    ]);
    const close = await hp.computeBaselinePrice('BTC', day, 'close');
    expect(close).toBe(100);

    // Intraday candles for VWAP: use equal typical prices 100 and 120 with vols 1 and 3
    Ex.fetchIntradayCandles.mockResolvedValueOnce([
      { ts: day + 3600_000, open: 100, high: 100, low: 100, close: 100, vol: 1 },
      { ts: day + 2*3600_000, open: 120, high: 120, low: 120, close: 120, vol: 3 },
    ]);
    const vwap = await hp.computeBaselinePrice('BTC', day, 'vwap');
    // typical prices equal close/open values; vwap = (100*1 + 120*3) / 4 = 115
    expect(vwap).toBeCloseTo(115);
  });

  test('computeBaselinePrice vwap fallback to daily typical price', async () => {
    const day = Date.UTC(2025, 1, 1); // Feb 1, 2025 UTC
    // No intraday data
    Ex.fetchIntradayCandles.mockResolvedValueOnce([]);
    // Daily candle available
    Ex.fetchDailyCandles.mockResolvedValueOnce([
      { ts: day, open: 0, high: 150, low: 90, close: 120, vol: 2000 },
    ]);
    const vwap = await hp.computeBaselinePrice('ETH', day, 'vwap');
    expect(vwap).toBeCloseTo((150 + 90 + 120) / 3);
  });
});

