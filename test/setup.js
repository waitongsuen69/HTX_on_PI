/**
 * Jest Global Test Setup
 * Configures global test environment, mocks, and utilities
 */

const fs = require('fs').promises;
const path = require('path');

// Setup global test environment
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(__dirname, 'temp');
process.env.REF_FIAT = 'USD';
process.env.PULL_INTERVAL_MS = '1000'; // Faster for tests
process.env.REQUEST_TIMEOUT_MS = '5000';
process.env.MAX_RETRY_ATTEMPTS = '2';

// Increase test timeout for integration tests
jest.setTimeout(10000);

// Global test utilities
global.testUtils = {
  /**
   * Create temporary directory for tests
   */
  async createTempDir() {
    const tempDir = path.join(__dirname, 'temp', `test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  },

  /**
   * Clean up temporary directory
   */
  async cleanupTempDir(tempDir) {
    if (tempDir && await this.pathExists(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },

  /**
   * Check if path exists
   */
  async pathExists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Sleep utility for async tests
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Generate test balances
   */
  createMockBalances() {
    return {
      BTC: { free: 0.5, locked: 0 },
      ETH: { free: 2.5, locked: 0 },
      USDT: { free: 1000.0, locked: 0 },
      BNB: { free: 10.0, locked: 0 }
    };
  },

  /**
   * Generate test prices
   */
  createMockPrices() {
    return {
      BTC: { last: 62000, change24h: -1.2 },
      ETH: { last: 3500, change24h: 2.1 },
      USDT: { last: 1.0, change24h: 0 },
      BNB: { last: 450, change24h: -0.8 }
    };
  },

  /**
   * Create mock lots data
   */
  createMockLotsData() {
    return {
      meta: { last_id: 4 },
      BTC: {
        lots: [
          { id: '000001', action: 'buy', qty: 0.3, unit_cost: 60000, ts: '2024-01-01T12:00:00Z' },
          { id: '000002', action: 'buy', qty: 0.2, unit_cost: 62000, ts: '2024-01-02T12:00:00Z' }
        ]
      },
      ETH: {
        lots: [
          { id: '000003', action: 'deposit', qty: 2.5, unit_cost: null, ts: '2024-01-01T12:00:00Z' }
        ]
      },
      USDT: {
        lots: [
          { id: '000004', action: 'deposit', qty: 1000.0, unit_cost: null, ts: '2024-01-01T12:00:00Z' }
        ]
      }
    };
  },

  /**
   * Create mock snapshot
   */
  createMockSnapshot() {
    return {
      time: Math.floor(Date.now() / 1000),
      ref_fiat: 'USD',
      total_value_usd: 43500.0,
      total_change_24h_pct: -0.8,
      positions: [
        {
          symbol: 'BTC',
          free: 0.5,
          price: 62000,
          value: 31000,
          day_pct: -1.2,
          pnl_pct: 1.5,
          avg_cost: 60800,
          unreconciled: false
        },
        {
          symbol: 'ETH',
          free: 2.5,
          price: 3500,
          value: 8750,
          day_pct: 2.1,
          pnl_pct: null,
          avg_cost: null,
          unreconciled: false
        },
        {
          symbol: 'BNB',
          free: 10.0,
          price: 450,
          value: 4500,
          day_pct: -0.8,
          pnl_pct: null,
          avg_cost: null,
          unreconciled: false
        }
      ]
    };
  },

  /**
   * Create mock HTX API responses
   */
  createMockHTXResponses() {
    return {
      balances: {
        status: 'ok',
        data: {
          id: 123456,
          type: 'spot',
          symbol: 'btc',
          list: [
            { currency: 'btc', type: 'trade', balance: '0.5' },
            { currency: 'eth', type: 'trade', balance: '2.5' },
            { currency: 'usdt', type: 'trade', balance: '1000.0' },
            { currency: 'bnb', type: 'trade', balance: '10.0' }
          ]
        }
      },
      prices: {
        status: 'ok',
        data: [
          { symbol: 'btcusdt', open: 62750, close: 62000, high: 63000, low: 61500 },
          { symbol: 'ethusdt', open: 3430, close: 3500, high: 3550, low: 3400 },
          { symbol: 'bnbusdt', open: 454, close: 450, high: 460, low: 445 }
        ]
      },
      timestamp: {
        status: 'ok',
        data: Date.now()
      }
    };
  }
};

// Mock console methods in test environment to reduce noise
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  // Suppress console output in tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  if (!process.env.DEBUG) {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

// Global cleanup
afterAll(async () => {
  // Clean up any test directories
  const tempDir = path.join(__dirname, 'temp');
  if (await global.testUtils.pathExists(tempDir)) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});