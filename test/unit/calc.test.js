/**
 * Portfolio Calculator Unit Tests
 * Tests P/L calculations, portfolio aggregation, and reconciliation
 */

const Calculator = require('../../src/calc');
const LotsManager = require('../../src/lots');

describe('Calculator', () => {
  let calculator;
  let mockLotsManager;

  beforeEach(() => {
    mockLotsManager = new LotsManager();
    calculator = new Calculator(mockLotsManager);
  });

  describe('Constructor', () => {
    test('should create instance with lots manager', () => {
      expect(calculator.lotsManager).toBe(mockLotsManager);
    });

    test('should create instance without lots manager', () => {
      const calc = new Calculator();
      expect(calc.lotsManager).toBeNull();
    });
  });

  describe('Portfolio Snapshot Computation', () => {
    let mockBalances, mockPrices, mockLotsData;

    beforeEach(() => {
      mockBalances = global.testUtils.createMockBalances();
      mockPrices = global.testUtils.createMockPrices();
      mockLotsData = global.testUtils.createMockLotsData();
    });

    test('should compute complete portfolio snapshot correctly', () => {
      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, mockLotsData);

      expect(snapshot).toHaveProperty('time');
      expect(snapshot).toHaveProperty('ref_fiat', 'USD');
      expect(snapshot).toHaveProperty('total_value_usd');
      expect(snapshot).toHaveProperty('total_change_24h_pct');
      expect(snapshot).toHaveProperty('positions');
      expect(Array.isArray(snapshot.positions)).toBe(true);

      // Check time is recent timestamp
      expect(snapshot.time).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
    });

    test('should calculate total portfolio value correctly', () => {
      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, mockLotsData);

      // Expected: BTC(0.5*62000) + ETH(2.5*3500) + USDT(1000*1) + BNB(10*450)
      // = 31000 + 8750 + 1000 + 4500 = 45250
      expect(snapshot.total_value_usd).toBeCloseTo(45250, 2);
    });

    test('should calculate weighted 24h change correctly', () => {
      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, mockLotsData);

      // Weighted calculation:
      // BTC: 31000 * (-1.2) = -37200
      // ETH: 8750 * 2.1 = 18375
      // USDT: 1000 * 0 = 0
      // BNB: 4500 * (-0.8) = -3600
      // Total: -22425, Portfolio: 45250
      // Weighted: -22425 / 45250 = -0.496%
      expect(snapshot.total_change_24h_pct).toBeCloseTo(-0.50, 1);
    });

    test('should sort positions by value descending', () => {
      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, mockLotsData);

      expect(snapshot.positions).toHaveLength(4);
      
      // Should be sorted: BTC(31000) > ETH(8750) > BNB(4500) > USDT(1000)
      expect(snapshot.positions[0].symbol).toBe('BTC');
      expect(snapshot.positions[1].symbol).toBe('ETH');
      expect(snapshot.positions[2].symbol).toBe('BNB');
      expect(snapshot.positions[3].symbol).toBe('USDT');
    });

    test('should exclude zero-value positions', () => {
      mockBalances.ZERO = { free: 0, locked: 0 };
      mockPrices.ZERO = { last: 100, change24h: 0 };

      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, mockLotsData);

      const zeroPosition = snapshot.positions.find(p => p.symbol === 'ZERO');
      expect(zeroPosition).toBeUndefined();
    });

    test('should handle missing lots data gracefully', () => {
      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, null);

      expect(snapshot.positions).toHaveLength(4);
      snapshot.positions.forEach(position => {
        expect(position.pnl_pct).toBeNull();
        expect(position.avg_cost).toBeNull();
        // When there are no lots but there is a balance, it should be unreconciled
        expect(position.unreconciled).toBe(true);
      });
    });

    test('should validate required inputs', () => {
      expect(() => calculator.computeSnapshot(null, mockPrices, mockLotsData))
        .toThrow('Balances data is required');

      expect(() => calculator.computeSnapshot(mockBalances, null, mockLotsData))
        .toThrow('Prices data is required');
    });

    test('should handle missing price data for symbol', () => {
      delete mockPrices.BTC;

      const snapshot = calculator.computeSnapshot(mockBalances, mockPrices, mockLotsData);

      const btcPosition = snapshot.positions.find(p => p.symbol === 'BTC');
      // BTC position should not be included because value is 0 (gets filtered out)
      expect(btcPosition).toBeUndefined();
    });
  });

  describe('Individual Position Calculation', () => {
    test('should calculate position with P/L correctly', () => {
      const balance = { free: 0.5, locked: 0 };
      const priceData = { last: 62000, change24h: -1.2 };
      const lotsData = {
        BTC: {
          lots: [
            { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' }
          ]
        }
      };

      const position = calculator.calculatePosition('BTC', balance, priceData, lotsData);

      expect(position).toEqual({
        symbol: 'BTC',
        free: 0.5,
        price: 62000,
        value: 31000,
        day_pct: -1.2,
        pnl_pct: 3.33, // (62000/60000 - 1) * 100 = 3.33%
        avg_cost: 60000,
        unreconciled: false
      });
    });

    test('should handle missing price data', () => {
      const balance = { free: 1.0, locked: 0 };
      const priceData = null;
      const lotsData = {};

      const position = calculator.calculatePosition('BTC', balance, priceData, lotsData);

      expect(position.price).toBe(0);
      expect(position.value).toBe(0);
      expect(position.day_pct).toBe(0);
    });

    test('should handle missing balance data', () => {
      const balance = null;
      const priceData = { last: 62000, change24h: -1.2 };
      const lotsData = {};

      const position = calculator.calculatePosition('BTC', balance, priceData, lotsData);

      expect(position.free).toBe(0);
      expect(position.value).toBe(0);
    });

    test('should handle position without cost basis', () => {
      const balance = { free: 2.0, locked: 0 };
      const priceData = { last: 3500, change24h: 2.1 };
      const lotsData = {
        ETH: {
          lots: [
            { id: '001', action: 'deposit', qty: 2.0, unit_cost: null, ts: '2024-01-01' }
          ]
        }
      };

      const position = calculator.calculatePosition('ETH', balance, priceData, lotsData);

      expect(position.pnl_pct).toBeNull();
      expect(position.avg_cost).toBeNull();
    });

    test('should detect unreconciled positions', () => {
      const balance = { free: 1.0, locked: 0 };
      const priceData = { last: 100, change24h: 0 };
      const lotsData = {
        TEST: {
          lots: [
            { id: '001', action: 'buy', qty: 0.5, unit_cost: 100, ts: '2024-01-01' }
          ]
        }
      };

      const position = calculator.calculatePosition('TEST', balance, priceData, lotsData);

      expect(position.unreconciled).toBe(true);
    });
  });

  describe('Average Cost Calculation', () => {
    test('should calculate weighted average cost correctly', () => {
      const lotsData = {
        BTC: {
          lots: [
            { id: '001', action: 'buy', qty: 0.3, unit_cost: 60000, ts: '2024-01-01' },
            { id: '002', action: 'buy', qty: 0.7, unit_cost: 64000, ts: '2024-01-02' }
          ]
        }
      };

      const avgCost = calculator.getAverageCost('BTC', lotsData);

      // Expected: (0.3 * 60000 + 0.7 * 64000) / (0.3 + 0.7) = 62800
      expect(avgCost).toBeCloseTo(62800);
    });

    test('should ignore lots with null unit_cost', () => {
      const lotsData = {
        ETH: {
          lots: [
            { id: '001', action: 'deposit', qty: 1.0, unit_cost: null, ts: '2024-01-01' },
            { id: '002', action: 'buy', qty: 2.0, unit_cost: 3500, ts: '2024-01-02' }
          ]
        }
      };

      const avgCost = calculator.getAverageCost('ETH', lotsData);

      expect(avgCost).toBe(3500); // Only considers the buy lot
    });

    test('should ignore negative quantities', () => {
      const lotsData = {
        BTC: {
          lots: [
            { id: '001', action: 'buy', qty: 1.0, unit_cost: 60000, ts: '2024-01-01' },
            { id: '002', action: 'sell', qty: -0.5, unit_cost: null, ts: '2024-01-02' }
          ]
        }
      };

      const avgCost = calculator.getAverageCost('BTC', lotsData);

      expect(avgCost).toBe(60000); // Only considers positive quantities
    });

    test('should ignore zero or negative unit_cost', () => {
      const lotsData = {
        TEST: {
          lots: [
            { id: '001', action: 'buy', qty: 1.0, unit_cost: 0, ts: '2024-01-01' },
            { id: '002', action: 'buy', qty: 1.0, unit_cost: -100, ts: '2024-01-02' },
            { id: '003', action: 'buy', qty: 1.0, unit_cost: 100, ts: '2024-01-03' }
          ]
        }
      };

      const avgCost = calculator.getAverageCost('TEST', lotsData);

      expect(avgCost).toBe(100); // Only considers positive unit_cost
    });

    test('should return null for non-existent symbol', () => {
      const avgCost = calculator.getAverageCost('NONEXISTENT', {});
      expect(avgCost).toBeNull();
    });

    test('should return null when no valid lots exist', () => {
      const lotsData = {
        ETH: {
          lots: [
            { id: '001', action: 'deposit', qty: 1.0, unit_cost: null, ts: '2024-01-01' }
          ]
        }
      };

      const avgCost = calculator.getAverageCost('ETH', lotsData);
      expect(avgCost).toBeNull();
    });
  });

  describe('Reconciliation Checking', () => {
    test('should identify reconciled balance', () => {
      const symbolLots = {
        lots: [
          { id: '001', action: 'buy', qty: 0.5, unit_cost: 100, ts: '2024-01-01' }
          // Total positive lots qty = 0.5, matches actual balance
        ]
      };

      const unreconciled = calculator.checkReconciliation(0.5, symbolLots);
      expect(unreconciled).toBe(false);
    });

    test('should identify unreconciled balance', () => {
      const symbolLots = {
        lots: [
          { id: '001', action: 'buy', qty: 0.5, unit_cost: 100, ts: '2024-01-01' }
        ]
      };

      const unreconciled = calculator.checkReconciliation(0.8, symbolLots);
      expect(unreconciled).toBe(true);
    });

    test('should handle floating point precision', () => {
      const symbolLots = {
        lots: [
          { id: '001', action: 'buy', qty: 0.1 + 0.2, unit_cost: 100, ts: '2024-01-01' }
        ]
      };

      const unreconciled = calculator.checkReconciliation(0.3, symbolLots);
      expect(unreconciled).toBe(false); // Should handle floating point precision
    });

    test('should handle null lots data', () => {
      const unreconciled = calculator.checkReconciliation(0.5, null);
      expect(unreconciled).toBe(true); // No lots but has balance = unreconciled
    });

    test('should handle zero balance with no lots', () => {
      const unreconciled = calculator.checkReconciliation(0, null);
      expect(unreconciled).toBe(false); // Zero balance, no lots = reconciled
    });
  });

  describe('Portfolio Statistics', () => {
    test('should calculate portfolio statistics correctly', () => {
      const positions = [
        { symbol: 'BTC', value: 31000, pnl_pct: 5.0, unreconciled: false },
        { symbol: 'ETH', value: 8750, pnl_pct: -2.0, unreconciled: false },
        { symbol: 'USDT', value: 1000, pnl_pct: null, unreconciled: true },
        { symbol: 'BNB', value: 4500, pnl_pct: 1.5, unreconciled: false }
      ];

      const stats = calculator.calculatePortfolioStats(positions);

      expect(stats.totalPositions).toBe(4);
      expect(stats.reconciled).toBe(3);
      expect(stats.unreconciled).toBe(1);
      expect(stats.withPnL).toBe(3);
      expect(stats.withoutPnL).toBe(1);

      // Weighted average P/L: (31000*5 + 8750*(-2) + 4500*1.5) / (31000+8750+4500)
      // = (155000 - 17500 + 6750) / 44250 = 144250 / 44250 = 3.26%
      expect(stats.avgPnL).toBeCloseTo(3.26, 2);

      expect(stats.bestPerformer.symbol).toBe('BTC');
      expect(stats.worstPerformer.symbol).toBe('ETH');
    });

    test('should handle empty positions array', () => {
      const stats = calculator.calculatePortfolioStats([]);

      expect(stats.totalPositions).toBe(0);
      expect(stats.avgPnL).toBeNull();
      expect(stats.bestPerformer).toBeNull();
      expect(stats.worstPerformer).toBeNull();
    });

    test('should handle positions without P/L data', () => {
      const positions = [
        { symbol: 'ETH', value: 1000, pnl_pct: null, unreconciled: false },
        { symbol: 'USDT', value: 500, pnl_pct: null, unreconciled: false }
      ];

      const stats = calculator.calculatePortfolioStats(positions);

      expect(stats.withPnL).toBe(0);
      expect(stats.withoutPnL).toBe(2);
      expect(stats.avgPnL).toBeNull();
    });
  });

  describe('Historical Metrics Calculation', () => {
    test('should calculate historical performance metrics', () => {
      const snapshots = [
        { time: 1000, total_value_usd: 10000 },
        { time: 2000, total_value_usd: 10500 },
        { time: 3000, total_value_usd: 10200 },
        { time: 4000, total_value_usd: 11000 }
      ];

      const metrics = calculator.calculateHistoricalMetrics(snapshots);

      expect(metrics.dataPoints).toBe(4);
      expect(metrics.periodReturn).toBeCloseTo(10.0, 1); // (11000/10000 - 1) * 100
      expect(metrics.maxValue).toBe(11000);
      expect(metrics.minValue).toBe(10000);
      expect(metrics.avgValue).toBeCloseTo(10425, 0);
      expect(typeof metrics.volatility).toBe('number');
    });

    test('should handle insufficient data points', () => {
      const snapshots = [
        { time: 1000, total_value_usd: 10000 }
      ];

      const metrics = calculator.calculateHistoricalMetrics(snapshots);

      expect(metrics.periodReturn).toBeNull();
      expect(metrics.volatility).toBeNull();
      expect(metrics.dataPoints).toBe(1);
    });

    test('should handle empty snapshots array', () => {
      const metrics = calculator.calculateHistoricalMetrics([]);

      expect(metrics.periodReturn).toBeNull();
      expect(metrics.volatility).toBeNull();
      expect(metrics.dataPoints).toBe(0);
    });

    test('should sort snapshots by time for calculation', () => {
      const unsortedSnapshots = [
        { time: 3000, total_value_usd: 10200 },
        { time: 1000, total_value_usd: 10000 },
        { time: 4000, total_value_usd: 11000 },
        { time: 2000, total_value_usd: 10500 }
      ];

      const metrics = calculator.calculateHistoricalMetrics(unsortedSnapshots);

      // Should use sorted order: start=10000, end=11000
      expect(metrics.periodReturn).toBeCloseTo(10.0, 1);
    });
  });

  describe('Data Validation', () => {
    test('should validate snapshot structure correctly', () => {
      const validSnapshot = {
        time: Math.floor(Date.now() / 1000),
        total_value_usd: 1000.50,
        positions: [
          {
            symbol: 'BTC',
            free: 0.5,
            price: 62000,
            value: 31000,
            day_pct: -1.2,
            pnl_pct: 5.0,
            avg_cost: 60000,
            unreconciled: false
          }
        ]
      };

      expect(calculator.validateSnapshot(validSnapshot)).toBe(true);
    });

    test('should reject invalid snapshot structures', () => {
      const invalidSnapshots = [
        null,
        {},
        { time: 'invalid', total_value_usd: 1000, positions: [] },
        { time: 1000, total_value_usd: -100, positions: [] },
        { time: 1000, total_value_usd: 1000, positions: 'not_array' },
        { time: 1000, total_value_usd: 1000, positions: [{ invalid: 'position' }] }
      ];

      invalidSnapshots.forEach(snapshot => {
        expect(calculator.validateSnapshot(snapshot)).toBe(false);
      });
    });

    test('should validate position structure correctly', () => {
      const validPosition = {
        symbol: 'BTC',
        free: 0.5,
        price: 62000,
        value: 31000,
        day_pct: -1.2,
        pnl_pct: 5.0,
        avg_cost: 60000,
        unreconciled: false
      };

      expect(calculator.validatePosition(validPosition)).toBe(true);
    });

    test('should reject invalid position structures', () => {
      const invalidPositions = [
        null,
        {},
        { symbol: '', free: 0.5, price: 100, value: 50 },
        { symbol: 'BTC', free: -1, price: 100, value: 50 },
        { symbol: 'BTC', free: 0.5, price: 100, value: 50, pnl_pct: 'invalid' },
        { symbol: 'BTC', free: 0.5, price: 100, value: 50, unreconciled: 'not_boolean' }
      ];

      invalidPositions.forEach(position => {
        expect(calculator.validatePosition(position)).toBe(false);
      });
    });

    test('should handle null values in optional fields', () => {
      const positionWithNulls = {
        symbol: 'ETH',
        free: 2.0,
        price: 3500,
        value: 7000,
        day_pct: 1.5,
        pnl_pct: null,
        avg_cost: null,
        unreconciled: false
      };

      expect(calculator.validatePosition(positionWithNulls)).toBe(true);
    });
  });

  describe('Formatting Utilities', () => {
    test('should format currency correctly', () => {
      expect(calculator.formatCurrency(1234.56, 'USD', 2)).toBe('1234.56 USD');
      expect(calculator.formatCurrency(0, 'BTC', 8)).toBe('0.00000000 BTC');
      expect(calculator.formatCurrency(null, 'USD', 2)).toBe('0.00 USD');
      expect(calculator.formatCurrency(NaN, 'USD', 2)).toBe('0.00 USD');
    });

    test('should format percentage correctly', () => {
      expect(calculator.formatPercentage(5.5, 2)).toBe('+5.50%');
      expect(calculator.formatPercentage(-2.3, 2)).toBe('-2.30%');
      expect(calculator.formatPercentage(0, 1)).toBe('+0.0%');
      expect(calculator.formatPercentage(null, 2)).toBe('N/A');
      expect(calculator.formatPercentage(NaN, 2)).toBe('N/A');
    });

    test('should handle custom decimal places', () => {
      expect(calculator.formatCurrency(1234.56789, 'USD', 4)).toBe('1234.5679 USD');
      expect(calculator.formatPercentage(5.66666, 3)).toBe('+5.667%');
    });
  });
});