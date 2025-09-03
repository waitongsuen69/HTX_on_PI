/**
 * Test Fixtures and Sample Data
 * Provides realistic test data for comprehensive testing scenarios
 */

/**
 * Sample LOFO lots data with various scenarios
 */
const sampleLotsData = {
  // Complete lots data with multiple symbols
  complete: {
    meta: { last_id: 8 },
    BTC: {
      lots: [
        { id: '000001', action: 'buy', qty: 0.3, unit_cost: 58000, ts: '2024-01-15T10:30:00Z' },
        { id: '000002', action: 'buy', qty: 0.2, unit_cost: 62000, ts: '2024-01-20T14:15:00Z' },
        { id: '000003', action: 'sell', qty: -0.1, unit_cost: null, ts: '2024-01-25T09:45:00Z' }
      ]
    },
    ETH: {
      lots: [
        { id: '000004', action: 'deposit', qty: 2.0, unit_cost: null, ts: '2024-01-10T08:00:00Z' },
        { id: '000005', action: 'buy', qty: 1.5, unit_cost: 3200, ts: '2024-01-18T16:20:00Z' },
        { id: '000006', action: 'withdraw', qty: -0.5, unit_cost: null, ts: '2024-01-28T11:30:00Z' }
      ]
    },
    USDT: {
      lots: [
        { id: '000007', action: 'deposit', qty: 5000, unit_cost: null, ts: '2024-01-01T00:00:00Z' },
        { id: '000008', action: 'withdraw', qty: -2000, unit_cost: null, ts: '2024-01-30T18:00:00Z' }
      ]
    }
  },

  // Lots with reconciliation issues
  unreconciled: {
    meta: { last_id: 3 },
    BTC: {
      lots: [
        { id: '000001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-15T10:30:00Z' }
        // Actual balance is 0.8 but lots only show 0.5
      ]
    },
    ETH: {
      lots: [
        { id: '000002', action: 'buy', qty: 2.0, unit_cost: 3500, ts: '2024-01-18T16:20:00Z' },
        { id: '000003', action: 'sell', qty: -2.5, unit_cost: null, ts: '2024-01-25T09:45:00Z' }
        // Sold more than owned - reconciliation issue
      ]
    }
  },

  // Mixed cost basis scenarios
  mixedCosts: {
    meta: { last_id: 6 },
    BTC: {
      lots: [
        { id: '000001', action: 'deposit', qty: 0.1, unit_cost: null, ts: '2024-01-01T00:00:00Z' },
        { id: '000002', action: 'buy', qty: 0.3, unit_cost: 55000, ts: '2024-01-15T10:30:00Z' },
        { id: '000003', action: 'buy', qty: 0.2, unit_cost: 65000, ts: '2024-01-20T14:15:00Z' },
        { id: '000004', action: 'buy', qty: 0.15, unit_cost: 70000, ts: '2024-01-25T16:00:00Z' }
      ]
    },
    ADA: {
      lots: [
        { id: '000005', action: 'buy', qty: 1000, unit_cost: 0.45, ts: '2024-01-10T12:00:00Z' },
        { id: '000006', action: 'buy', qty: 500, unit_cost: 0.52, ts: '2024-01-22T14:30:00Z' }
      ]
    }
  }
};

/**
 * Sample balance data from exchange
 */
const sampleBalances = {
  // Typical portfolio
  typical: {
    BTC: { free: 0.4, locked: 0 },
    ETH: { free: 3.0, locked: 0 },
    USDT: { free: 3000, locked: 0 },
    BNB: { free: 5.5, locked: 0 },
    ADA: { free: 1500, locked: 0 }
  },

  // Large portfolio
  large: {
    BTC: { free: 5.5, locked: 0.1 },
    ETH: { free: 25.0, locked: 2.0 },
    USDT: { free: 50000, locked: 5000 },
    BNB: { free: 100, locked: 0 },
    ADA: { free: 25000, locked: 0 },
    DOT: { free: 500, locked: 0 },
    LINK: { free: 200, locked: 0 },
    UNI: { free: 300, locked: 0 }
  },

  // Small portfolio
  small: {
    BTC: { free: 0.01, locked: 0 },
    ETH: { free: 0.1, locked: 0 },
    USDT: { free: 100, locked: 0 }
  },

  // Edge case - dust amounts
  dust: {
    BTC: { free: 0.00000001, locked: 0 },
    ETH: { free: 0.000001, locked: 0 },
    USDT: { free: 0.01, locked: 0 }
  }
};

/**
 * Sample price data
 */
const samplePrices = {
  // Bull market scenario
  bullMarket: {
    BTC: { last: 75000, change24h: 8.5 },
    ETH: { last: 4200, change24h: 12.3 },
    USDT: { last: 1.0, change24h: 0.0 },
    BNB: { last: 650, change24h: 15.2 },
    ADA: { last: 0.85, change24h: 25.6 },
    DOT: { last: 45, change24h: 18.9 },
    LINK: { last: 28, change24h: 22.1 },
    UNI: { last: 15, change24h: 19.7 }
  },

  // Bear market scenario
  bearMarket: {
    BTC: { last: 32000, change24h: -15.2 },
    ETH: { last: 1800, change24h: -18.7 },
    USDT: { last: 1.0, change24h: 0.0 },
    BNB: { last: 220, change24h: -12.3 },
    ADA: { last: 0.25, change24h: -22.8 },
    DOT: { last: 8, change24h: -25.1 },
    LINK: { last: 6, change24h: -20.5 },
    UNI: { last: 3, change24h: -28.9 }
  },

  // Stable market
  stable: {
    BTC: { last: 62000, change24h: -0.2 },
    ETH: { last: 3500, change24h: 0.8 },
    USDT: { last: 1.0, change24h: 0.0 },
    BNB: { last: 450, change24h: -0.5 },
    ADA: { last: 0.52, change24h: 1.2 },
    DOT: { last: 25, change24h: -1.1 },
    LINK: { last: 18, change24h: 2.3 },
    UNI: { last: 8, change24h: -0.8 }
  },

  // Missing price data scenario
  partial: {
    BTC: { last: 62000, change24h: -1.2 },
    ETH: { last: 3500, change24h: 2.1 },
    USDT: { last: 1.0, change24h: 0.0 }
    // Missing prices for other symbols
  }
};

/**
 * Sample portfolio snapshots
 */
const sampleSnapshots = {
  // Historical snapshots for trend analysis
  historical: [
    {
      time: 1705136400, // 2024-01-13 09:00:00 UTC
      ref_fiat: 'USD',
      total_value_usd: 42500.00,
      total_change_24h_pct: -2.1,
      positions: [
        { symbol: 'BTC', free: 0.4, price: 61000, value: 24400, day_pct: -3.2, pnl_pct: 5.2, avg_cost: 58000, unreconciled: false },
        { symbol: 'ETH', free: 3.0, price: 3400, value: 10200, day_pct: -1.8, pnl_pct: 6.3, avg_cost: 3200, unreconciled: false },
        { symbol: 'USDT', free: 3000, price: 1.0, value: 3000, day_pct: 0.0, pnl_pct: null, avg_cost: null, unreconciled: false },
        { symbol: 'BNB', free: 5.5, price: 440, value: 2420, day_pct: -2.5, pnl_pct: 2.3, avg_cost: 430, unreconciled: false },
        { symbol: 'ADA', free: 1500, price: 0.51, value: 765, day_pct: -4.1, pnl_pct: 8.5, avg_cost: 0.47, unreconciled: false }
      ]
    },
    {
      time: 1705222800, // 2024-01-14 09:00:00 UTC
      ref_fiat: 'USD',
      total_value_usd: 44200.00,
      total_change_24h_pct: 1.5,
      positions: [
        { symbol: 'BTC', free: 0.4, price: 62500, value: 25000, day_pct: 2.5, pnl_pct: 7.8, avg_cost: 58000, unreconciled: false },
        { symbol: 'ETH', free: 3.0, price: 3550, value: 10650, day_pct: 4.4, pnl_pct: 10.9, avg_cost: 3200, unreconciled: false },
        { symbol: 'USDT', free: 3000, price: 1.0, value: 3000, day_pct: 0.0, pnl_pct: null, avg_cost: null, unreconciled: false },
        { symbol: 'BNB', free: 5.5, price: 460, value: 2530, day_pct: 4.5, pnl_pct: 7.0, avg_cost: 430, unreconciled: false },
        { symbol: 'ADA', free: 1500, price: 0.54, value: 810, day_pct: 5.9, pnl_pct: 14.9, avg_cost: 0.47, unreconciled: false }
      ]
    },
    {
      time: 1705309200, // 2024-01-15 09:00:00 UTC
      ref_fiat: 'USD',
      total_value_usd: 43800.00,
      total_change_24h_pct: -0.9,
      positions: [
        { symbol: 'BTC', free: 0.4, price: 61800, value: 24720, day_pct: -1.1, pnl_pct: 6.6, avg_cost: 58000, unreconciled: false },
        { symbol: 'ETH', free: 3.0, price: 3480, value: 10440, day_pct: -2.0, pnl_pct: 8.8, avg_cost: 3200, unreconciled: false },
        { symbol: 'USDT', free: 3000, price: 1.0, value: 3000, day_pct: 0.0, pnl_pct: null, avg_cost: null, unreconciled: false },
        { symbol: 'BNB', free: 5.5, price: 445, value: 2447.5, day_pct: -3.3, pnl_pct: 3.5, avg_cost: 430, unreconciled: false },
        { symbol: 'ADA', free: 1500, price: 0.525, value: 787.5, day_pct: -2.8, pnl_pct: 11.7, avg_cost: 0.47, unreconciled: false }
      ]
    }
  ],

  // Performance scenarios
  highPerformer: {
    time: Math.floor(Date.now() / 1000),
    ref_fiat: 'USD',
    total_value_usd: 125000.00,
    total_change_24h_pct: 12.5,
    positions: [
      { symbol: 'BTC', free: 1.0, price: 75000, value: 75000, day_pct: 8.5, pnl_pct: 25.0, avg_cost: 60000, unreconciled: false },
      { symbol: 'ETH', free: 10.0, price: 4200, value: 42000, day_pct: 12.3, pnl_pct: 31.3, avg_cost: 3200, unreconciled: false },
      { symbol: 'BNB', free: 12.3, price: 650, value: 7995, day_pct: 15.2, pnl_pct: 44.4, avg_cost: 450, unreconciled: false }
    ]
  },

  underperformer: {
    time: Math.floor(Date.now() / 1000),
    ref_fiat: 'USD',
    total_value_usd: 28500.00,
    total_change_24h_pct: -18.2,
    positions: [
      { symbol: 'BTC', free: 0.5, price: 32000, value: 16000, day_pct: -15.2, pnl_pct: -46.7, avg_cost: 60000, unreconciled: false },
      { symbol: 'ETH', free: 5.0, price: 1800, value: 9000, day_pct: -18.7, pnl_pct: -43.8, avg_cost: 3200, unreconciled: false },
      { symbol: 'USDT', free: 3500, price: 1.0, value: 3500, day_pct: 0.0, pnl_pct: null, avg_cost: null, unreconciled: false }
    ]
  }
};

/**
 * Test scenarios for LOFO algorithm
 */
const lofoTestScenarios = [
  {
    name: 'Basic LOFO Deduction',
    lots: [
      { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' },
      { id: '002', action: 'buy', qty: 0.3, unit_cost: 55000, ts: '2024-01-02' }
    ],
    deduction: 0.4,
    expectedResult: [
      { id: '002', action: 'buy', qty: 0.2, unit_cost: 55000, ts: '2024-01-02' },
      { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' }
    ]
  },
  {
    name: 'Null Cost Handling',
    lots: [
      { id: '001', action: 'deposit', qty: 1.0, unit_cost: null, ts: '2024-01-01' },
      { id: '002', action: 'buy', qty: 0.5, unit_cost: 50000, ts: '2024-01-02' }
    ],
    deduction: 0.3,
    expectedResult: [
      { id: '002', action: 'buy', qty: 0.2, unit_cost: 50000, ts: '2024-01-02' },
      { id: '001', action: 'deposit', qty: 1.0, unit_cost: null, ts: '2024-01-01' }
    ]
  },
  {
    name: 'Complete Lot Consumption',
    lots: [
      { id: '001', action: 'buy', qty: 0.2, unit_cost: 45000, ts: '2024-01-01' },
      { id: '002', action: 'buy', qty: 0.3, unit_cost: 50000, ts: '2024-01-02' }
    ],
    deduction: 0.5,
    expectedResult: []
  }
];

/**
 * Error test scenarios
 */
const errorScenarios = {
  network: {
    type: 'network',
    description: 'Network connection errors'
  },
  timeout: {
    type: 'timeout',
    description: 'Request timeout errors'
  },
  rateLimit: {
    type: 'http',
    code: 429,
    message: 'Too Many Requests',
    description: 'API rate limiting'
  },
  unauthorized: {
    type: 'http',
    code: 401,
    message: 'Invalid signature',
    description: 'Authentication failures'
  },
  serverError: {
    type: 'http',
    code: 500,
    message: 'Internal Server Error',
    description: 'Server-side errors'
  },
  invalidResponse: {
    type: 'invalid-json',
    description: 'Malformed JSON responses'
  }
};

/**
 * Performance test data
 */
const performanceTestData = {
  largeLotsList: Array.from({ length: 1000 }, (_, i) => ({
    id: String(i + 1).padStart(6, '0'),
    action: i % 4 === 0 ? 'deposit' : 'buy',
    qty: Math.random() * 10,
    unit_cost: i % 4 === 0 ? null : Math.floor(Math.random() * 100000),
    ts: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
  })),

  largeSnapshotHistory: Array.from({ length: 100 }, (_, i) => ({
    time: Math.floor(Date.now() / 1000) - (99 - i) * 3600, // Hourly snapshots
    ref_fiat: 'USD',
    total_value_usd: 40000 + Math.sin(i / 10) * 10000 + Math.random() * 2000,
    total_change_24h_pct: (Math.random() - 0.5) * 10,
    positions: [
      {
        symbol: 'BTC',
        free: 0.5,
        price: 60000 + Math.sin(i / 5) * 5000 + Math.random() * 2000,
        value: 0,
        day_pct: (Math.random() - 0.5) * 8,
        pnl_pct: (Math.random() - 0.3) * 20,
        avg_cost: 58000,
        unreconciled: false
      }
    ]
  }))
};

module.exports = {
  sampleLotsData,
  sampleBalances,
  samplePrices,
  sampleSnapshots,
  lofoTestScenarios,
  errorScenarios,
  performanceTestData
};