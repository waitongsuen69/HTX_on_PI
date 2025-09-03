# HTX Pi Monitor — Test Specification & Implementation

## Overview
Complete test suite designed to run on macOS/Linux development environments while validating Pi deployment readiness. Uses Jest for unit tests, Supertest for API testing, and custom harnesses for integration scenarios.

---

## Test Environment Setup

### Dependencies
```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "supertest": "^6.3.0",
    "nock": "^13.5.0",
    "dotenv": "^16.4.0",
    "nodemon": "^3.1.0",
    "cross-env": "^7.0.3"
  },
  "scripts": {
    "test": "jest --coverage",
    "test:watch": "jest --watch",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "jest --testPathPattern=e2e --runInBand",
    "test:stress": "node test/stress/runner.js",
    "test:mock-server": "node test/mocks/htx-mock-server.js"
  }
}
```

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js', // Tested via integration
    '!**/node_modules/**'
  ],
  testMatch: [
    '**/test/**/*.test.js'
  ],
  setupFilesAfterEnv: ['./test/setup.js'],
  testTimeout: 10000,
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

---

## Directory Structure
```
test/
├── setup.js              # Global test setup
├── fixtures/             # Test data
│   ├── balances.json
│   ├── prices.json
│   ├── lots.json
│   └── snapshots.json
├── mocks/               # Mock implementations
│   ├── htx-mock-server.js
│   └── htx-responses.js
├── unit/                # Unit tests
│   ├── lots.test.js
│   ├── calc.test.js
│   ├── state.test.js
│   └── htx.test.js
├── integration/         # Integration tests
│   ├── api.test.js
│   ├── scheduler.test.js
│   └── persistence.test.js
├── e2e/                 # End-to-end tests
│   └── workflow.test.js
└── stress/              # Performance tests
    └── runner.js
```

---

## Test Implementation

### Test Setup Helper
```javascript
// test/setup.js
const fs = require('fs').promises;
const path = require('path');

global.testDataDir = path.join(__dirname, '.test-data');

beforeAll(async () => {
  // Create test data directory
  await fs.mkdir(global.testDataDir, { recursive: true });
  
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Random port
  process.env.HTX_ACCESS_KEY = 'test-access-key';
  process.env.HTX_SECRET_KEY = 'test-secret-key';
  process.env.HTX_ACCOUNT_ID = 'test-account';
});

afterAll(async () => {
  // Cleanup test data
  await fs.rm(global.testDataDir, { recursive: true, force: true });
});

// Test utilities
global.createTestLots = () => ({
  meta: { last_id: 3 },
  BTC: {
    lots: [
      { id: "000001", action: "buy", qty: 0.10, unit_cost: 60000, ts: "2025-01-01T12:00:00Z" },
      { id: "000002", action: "buy", qty: 0.20, unit_cost: 55000, ts: "2025-01-10T09:30:00Z" },
      { id: "000003", action: "withdraw", qty: 0.15, ts: "2025-02-15T18:20:00Z" }
    ]
  },
  ETH: {
    lots: [
      { id: "000004", action: "buy", qty: 2.5, unit_cost: 3000, ts: "2025-01-05T10:00:00Z" }
    ]
  }
});

global.createTestBalances = () => ({
  BTC: { free: 0.15, locked: 0 },
  ETH: { free: 2.5, locked: 0 },
  USDT: { free: 1000, locked: 0 }
});

global.createTestPrices = () => ({
  BTC: { last: 62000, change24h: -1.2 },
  ETH: { last: 3200, change24h: 2.5 },
  USDT: { last: 1, change24h: 0 }
});
```

---

## Unit Tests

### LOFO Accounting Tests
```javascript
// test/unit/lots.test.js
const LotsManager = require('../../src/lots');

describe('LotsManager', () => {
  let lotsManager;
  
  beforeEach(() => {
    lotsManager = new LotsManager(global.testDataDir);
  });
  
  describe('LOFO deduction', () => {
    test('should deduct from lowest cost lots first', () => {
      const lots = [
        { id: '000001', qty: 0.10, unit_cost: 60000 },
        { id: '000002', qty: 0.20, unit_cost: 55000 }
      ];
      
      const result = lotsManager.deductLOFO(lots, 0.15);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: '000002', qty: 0.05, unit_cost: 55000 });
      expect(result[1]).toMatchObject({ id: '000001', qty: 0.10, unit_cost: 60000 });
    });
    
    test('should treat null unit_cost as infinity', () => {
      const lots = [
        { id: '000001', qty: 0.10, unit_cost: null },
        { id: '000002', qty: 0.20, unit_cost: 55000 },
        { id: '000003', qty: 0.15, unit_cost: 58000 }
      ];
      
      const result = lotsManager.deductLOFO(lots, 0.25);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: '000003', qty: 0.10, unit_cost: 58000 });
      expect(result[1]).toMatchObject({ id: '000001', qty: 0.10, unit_cost: null });
    });
    
    test('should remove depleted lots', () => {
      const lots = [
        { id: '000001', qty: 0.10, unit_cost: 60000 },
        { id: '000002', qty: 0.05, unit_cost: 55000 }
      ];
      
      const result = lotsManager.deductLOFO(lots, 0.15);
      
      expect(result).toHaveLength(0);
    });
    
    test('should handle partial deduction', () => {
      const lots = [
        { id: '000001', qty: 0.50, unit_cost: 60000 }
      ];
      
      const result = lotsManager.deductLOFO(lots, 0.30);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: '000001', qty: 0.20, unit_cost: 60000 });
    });
  });
  
  describe('ID generation', () => {
    test('should generate sequential padded IDs', () => {
      const meta = { last_id: 0 };
      
      expect(lotsManager.nextId(meta)).toBe('000001');
      expect(lotsManager.nextId(meta)).toBe('000002');
      expect(lotsManager.nextId(meta)).toBe('000003');
      
      meta.last_id = 999;
      expect(lotsManager.nextId(meta)).toBe('001000');
      
      meta.last_id = 999999;
      expect(lotsManager.nextId(meta)).toBe('1000000');
    });
  });
  
  describe('applyEntry', () => {
    test('should apply buy entry', () => {
      const lotsData = { meta: { last_id: 0 } };
      
      lotsManager.applyEntry(lotsData, 'BTC', {
        action: 'buy',
        qty: 0.1,
        unit_cost: 50000,
        ts: new Date().toISOString()
      });
      
      expect(lotsData.BTC.lots).toHaveLength(1);
      expect(lotsData.BTC.lots[0]).toMatchObject({
        id: '000001',
        action: 'buy',
        qty: 0.1,
        unit_cost: 50000
      });
    });
    
    test('should apply sell with LOFO', () => {
      const lotsData = {
        meta: { last_id: 2 },
        BTC: {
          lots: [
            { id: '000001', qty: 0.10, unit_cost: 60000 },
            { id: '000002', qty: 0.20, unit_cost: 55000 }
          ]
        }
      };
      
      lotsManager.applyEntry(lotsData, 'BTC', {
        action: 'sell',
        qty: 0.15
      });
      
      // Should have remaining lots after LOFO
      const remainingQty = lotsData.BTC.lots
        .filter(l => l.qty > 0)
        .reduce((sum, l) => sum + l.qty, 0);
      
      expect(remainingQty).toBeCloseTo(0.15, 10);
    });
  });
});
```

### Calculator Tests
```javascript
// test/unit/calc.test.js
const Calculator = require('../../src/calc');

describe('Calculator', () => {
  let calculator;
  
  beforeEach(() => {
    calculator = new Calculator();
  });
  
  describe('computeSnapshot', () => {
    test('should calculate correct portfolio values', () => {
      const balances = global.createTestBalances();
      const prices = global.createTestPrices();
      const lotsData = global.createTestLots();
      
      const snapshot = calculator.computeSnapshot(balances, prices, lotsData);
      
      expect(snapshot).toMatchObject({
        ref_fiat: 'USD',
        total_value_usd: expect.any(Number),
        total_change_24h_pct: expect.any(Number),
        positions: expect.arrayContaining([
          expect.objectContaining({
            symbol: 'BTC',
            free: 0.15,
            price: 62000,
            value: 9300,
            day_pct: -1.2
          })
        ])
      });
      
      // Total value should be sum of all positions
      const expectedTotal = 0.15 * 62000 + 2.5 * 3200 + 1000 * 1;
      expect(snapshot.total_value_usd).toBeCloseTo(expectedTotal, 2);
    });
    
    test('should calculate P/L percentage correctly', () => {
      const balances = { BTC: { free: 0.30 } };
      const prices = { BTC: { last: 62000, change24h: 0 } };
      const lotsData = {
        BTC: {
          lots: [
            { id: '000001', qty: 0.10, unit_cost: 60000 },
            { id: '000002', qty: 0.20, unit_cost: 55000 }
          ]
        }
      };
      
      const snapshot = calculator.computeSnapshot(balances, prices, lotsData);
      const btcPosition = snapshot.positions.find(p => p.symbol === 'BTC');
      
      // Average cost = (0.10 * 60000 + 0.20 * 55000) / 0.30 = 56666.67
      // P/L% = (62000 / 56666.67 - 1) * 100 = 9.41%
      expect(btcPosition.pnl_pct).toBeCloseTo(9.41, 1);
    });
    
    test('should handle null unit_cost in P/L calculation', () => {
      const balances = { BTC: { free: 0.20 } };
      const prices = { BTC: { last: 62000, change24h: 0 } };
      const lotsData = {
        BTC: {
          lots: [
            { id: '000001', qty: 0.10, unit_cost: 60000 },
            { id: '000002', qty: 0.10, unit_cost: null }
          ]
        }
      };
      
      const snapshot = calculator.computeSnapshot(balances, prices, lotsData);
      const btcPosition = snapshot.positions.find(p => p.symbol === 'BTC');
      
      // Should only use valid cost lot: (62000 / 60000 - 1) * 100 = 3.33%
      expect(btcPosition.pnl_pct).toBeCloseTo(3.33, 1);
    });
    
    test('should detect reconciliation issues', () => {
      const balances = { BTC: { free: 0.25 } }; // Actual balance
      const prices = { BTC: { last: 62000, change24h: 0 } };
      const lotsData = {
        BTC: {
          lots: [
            { id: '000001', qty: 0.10, unit_cost: 60000 },
            { id: '000002', qty: 0.10, unit_cost: 55000 } // Total: 0.20
          ]
        }
      };
      
      const snapshot = calculator.computeSnapshot(balances, prices, lotsData);
      const btcPosition = snapshot.positions.find(p => p.symbol === 'BTC');
      
      expect(btcPosition.unreconciled).toBe(true);
    });
  });
  
  describe('weighted change calculation', () => {
    test('should calculate weighted 24h change', () => {
      const balances = {
        BTC: { free: 0.1 },
        ETH: { free: 2 }
      };
      const prices = {
        BTC: { last: 60000, change24h: -2.0 },
        ETH: { last: 3000, change24h: 3.0 }
      };
      const lotsData = {};
      
      const snapshot = calculator.computeSnapshot(balances, prices, lotsData);
      
      // BTC value: 6000, weight: 50%, contribution: -1.0%
      // ETH value: 6000, weight: 50%, contribution: 1.5%
      // Total weighted: 0.5%
      expect(snapshot.total_change_24h_pct).toBeCloseTo(0.5, 2);
    });
  });
});
```

### State Management Tests
```javascript
// test/unit/state.test.js
const StateManager = require('../../src/state');
const fs = require('fs').promises;
const path = require('path');

describe('StateManager', () => {
  let stateManager;
  
  beforeEach(() => {
    stateManager = new StateManager(global.testDataDir, 5);
  });
  
  describe('atomic writes', () => {
    test('should write atomically', async () => {
      const testData = { test: 'data', timestamp: Date.now() };
      const filePath = path.join(global.testDataDir, 'atomic.json');
      
      await stateManager.atomicWrite(filePath, testData);
      
      const content = await fs.readFile(filePath, 'utf8');
      expect(JSON.parse(content)).toEqual(testData);
      
      // Verify no temp files left
      const files = await fs.readdir(global.testDataDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });
    
    test('should handle concurrent writes', async () => {
      const filePath = path.join(global.testDataDir, 'concurrent.json');
      
      // Simulate concurrent writes
      const writes = Array(10).fill(0).map((_, i) => 
        stateManager.atomicWrite(filePath, { id: i })
      );
      
      await Promise.all(writes);
      
      // Last write should win
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      expect(data).toHaveProperty('id');
      expect(data.id).toBeGreaterThanOrEqual(0);
      expect(data.id).toBeLessThan(10);
    });
  });
  
  describe('snapshot management', () => {
    test('should maintain rolling history', async () => {
      // Add more than max history
      for (let i = 0; i < 10; i++) {
        await stateManager.saveSnapshot({
          time: i,
          total_value_usd: 1000 + i
        });
      }
      
      const history = stateManager.getHistory();
      expect(history).toHaveLength(5); // maxHistory = 5
      expect(history[0].time).toBe(9); // Most recent first
      expect(history[4].time).toBe(5); // Oldest retained
    });
    
    test('should persist and restore state', async () => {
      const snapshot = {
        time: Date.now(),
        total_value_usd: 12345.67,
        positions: []
      };
      
      await stateManager.saveSnapshot(snapshot);
      
      // Create new instance to test persistence
      const newStateManager = new StateManager(global.testDataDir, 5);
      await newStateManager.loadState();
      
      const latest = newStateManager.getLatestSnapshot();
      expect(latest).toEqual(snapshot);
    });
  });
});
```

---

## Integration Tests

### API Integration Tests
```javascript
// test/integration/api.test.js
const request = require('supertest');
const Server = require('../../src/server');
const StateManager = require('../../src/state');

describe('API Integration', () => {
  let app;
  let server;
  let stateManager;
  
  beforeAll(async () => {
    stateManager = new StateManager(global.testDataDir);
    server = new Server(0, '127.0.0.1', stateManager);
    app = server.app;
    
    // Add test data
    await stateManager.saveSnapshot({
      time: Math.floor(Date.now() / 1000),
      total_value_usd: 10000,
      positions: []
    });
  });
  
  describe('GET /api/health', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        now: expect.any(Number),
        lastSnapshotAt: expect.any(Number)
      });
    });
  });
  
  describe('GET /api/snapshot', () => {
    test('should return latest snapshot', async () => {
      const response = await request(app)
        .get('/api/snapshot')
        .expect(200);
      
      expect(response.body).toMatchObject({
        time: expect.any(Number),
        total_value_usd: 10000,
        positions: []
      });
    });
    
    test('should handle no data gracefully', async () => {
      const emptyStateManager = new StateManager(global.testDataDir + '-empty');
      const emptyServer = new Server(0, '127.0.0.1', emptyStateManager);
      
      const response = await request(emptyServer.app)
        .get('/api/snapshot')
        .expect(404);
      
      expect(response.body).toMatchObject({
        error: expect.stringContaining('No snapshot')
      });
    });
  });
  
  describe('GET /api/history', () => {
    test('should return history with limit', async () => {
      // Add more snapshots
      for (let i = 0; i < 5; i++) {
        await stateManager.saveSnapshot({
          time: Math.floor(Date.now() / 1000) + i,
          total_value_usd: 10000 + i * 100
        });
      }
      
      const response = await request(app)
        .get('/api/history?n=3')
        .expect(200);
      
      expect(response.body.history).toHaveLength(3);
      expect(response.body.history[0].total_value_usd).toBe(10400);
    });
  });
});
```

### HTX Mock Server
```javascript
// test/mocks/htx-mock-server.js
const express = require('express');
const crypto = require('crypto');

class HTXMockServer {
  constructor(port = 3001) {
    this.app = express();
    this.port = port;
    this.setupRoutes();
    this.requestCount = 0;
    this.shouldFail = false;
  }
  
  setupRoutes() {
    // Rate limiting simulation
    this.app.use((req, res, next) => {
      this.requestCount++;
      
      if (this.shouldFail) {
        return res.status(503).json({ error: 'Service unavailable' });
      }
      
      if (this.requestCount % 10 === 0) {
        return res.status(429).json({ error: 'Rate limited' });
      }
      
      next();
    });
    
    // Balance endpoint
    this.app.get('/v1/account/accounts/:id/balance', (req, res) => {
      // Verify signature
      const signature = req.headers['signature'];
      if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
      }
      
      res.json({
        status: 'ok',
        data: {
          list: [
            { currency: 'btc', type: 'trade', balance: '0.15' },
            { currency: 'eth', type: 'trade', balance: '2.5' },
            { currency: 'usdt', type: 'trade', balance: '1000' }
          ]
        }
      });
    });
    
    // Price endpoint
    this.app.get('/market/tickers', (req, res) => {
      res.json({
        status: 'ok',
        data: [
          { symbol: 'btcusdt', close: 62000, open: 62744 },
          { symbol: 'ethusdt', close: 3200, open: 3120 },
          { symbol: 'usdtusdt', close: 1, open: 1 }
        ]
      });
    });
  }
  
  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`HTX Mock Server running on port ${this.port}`);
        resolve();
      });
    });
  }
  
  stop() {
    return new Promise((resolve) => {
      this.server.close(resolve);
    });
  }
  
  simulateOutage() {
    this.shouldFail = true;
  }
  
  recover() {
    this.shouldFail = false;
  }
}

// Run standalone for testing
if (require.main === module) {
  const server = new HTXMockServer();
  server.start();
  
  // Simulate failures
  setTimeout(() => {
    console.log('Simulating outage...');
    server.simulateOutage();
  }, 30000);
  
  setTimeout(() => {
    console.log('Recovering...');
    server.recover();
  }, 35000);
}

module.exports = HTXMockServer;
```

---

## End-to-End Tests

```javascript
// test/e2e/workflow.test.js
const Server = require('../../src/server');
const Scheduler = require('../../src/scheduler');
const HTXClient = require('../../src/htx');
const HTXMockServer = require('../mocks/htx-mock-server');
const request = require('supertest');

describe('E2E Workflow', () => {
  let mockHTX;
  let server;
  let scheduler;
  
  beforeAll(async () => {
    // Start mock HTX server
    mockHTX = new HTXMockServer(3001);
    await mockHTX.start();
    
    // Configure client to use mock
    process.env.HTX_BASE_URL = 'http://localhost:3001';
    
    // Start application
    const htxClient = new HTXClient(
      process.env.HTX_ACCESS_KEY,
      process.env.HTX_SECRET_KEY,
      process.env.HTX_ACCOUNT_ID
    );
    
    server = new Server();
    scheduler = new Scheduler(htxClient, server.stateManager);
    
    await scheduler.start();
  });
  
  afterAll(async () => {
    await scheduler.stop();
    await mockHTX.stop();
  });
  
  test('should complete full data cycle', async () => {
    // Wait for first pull cycle
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check snapshot created
    const response = await request(server.app)
      .get('/api/snapshot')
      .expect(200);
    
    expect(response.body).toMatchObject({
      total_value_usd: expect.any(Number),
      positions: expect.arrayContaining([
        expect.objectContaining({
          symbol: 'BTC',
          free: 0.15,
          value: expect.any(Number)
        })
      ])
    });
  });
  
  test('should handle API failures gracefully', async () => {
    // Simulate HTX outage
    mockHTX.simulateOutage();
    
    // Wait for retry
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Should still serve last known data
    const response = await request(server.app)
      .get('/api/snapshot')
      .expect(200);
    
    expect(response.body).toBeDefined();
    
    // Recover
    mockHTX.recover();
  });
  
  test('should maintain data consistency', async () => {
    // Get initial state
    const initial = await request(server.app)
      .get('/api/snapshot')
      .expect(200);
    
    // Trigger multiple cycles
    for (let i = 0; i < 3; i++) {
      await scheduler.pullCycle();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Check history maintained
    const history = await request(server.app)
      .get('/api/history?n=10')
      .expect(200);
    
    expect(history.body.history.length).toBeGreaterThanOrEqual(3);
    
    // Verify no data corruption
    history.body.history.forEach(snapshot => {
      expect(snapshot).toMatchObject({
        time: expect.any(Number),
        total_value_usd: expect.any(Number),
        positions: expect.any(Array)
      });
    });
  });
});
```

---

## Stress Testing

```javascript
// test/stress/runner.js
const axios = require('axios');
const { performance } = require('perf_hooks');

class StressTestRunner {
  constructor(baseURL = 'http://localhost:8080') {
    this.baseURL = baseURL;
    this.results = {
      requests: 0,
      success: 0,
      failed: 0,
      latencies: [],
      errors: []
    };
  }
  
  async runTest(duration = 60000, rps = 10) {
    console.log(`Starting stress test: ${duration}ms @ ${rps} req/s`);
    
    const interval = 1000 / rps;
    const endTime = Date.now() + duration;
    
    const tasks = [];
    
    while (Date.now() < endTime) {
      tasks.push(this.makeRequest());
      await this.sleep(interval);
    }
    
    await Promise.all(tasks);
    this.printResults();
  }
  
  async makeRequest() {
    const start = performance.now();
    this.results.requests++;
    
    try {
      const response = await axios.get(`${this.baseURL}/api/snapshot`, {
        timeout: 5000
      });
      
      const latency = performance.now() - start;
      this.results.success++;
      this.results.latencies.push(latency);
      
      // Validate response
      if (!response.data.positions) {
        throw new Error('Invalid response structure');
      }
    } catch (error) {
      this.results.failed++;
      this.results.errors.push(error.message);
    }
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  printResults() {
    const latencies = this.results.latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    
    console.log('\n=== Stress Test Results ===');
    console.log(`Total Requests: ${this.results.requests}`);
    console.log(`Success: ${this.results.success} (${(this.results.success/this.results.requests*100).toFixed(2)}%)`);
    console.log(`Failed: ${this.results.failed}`);
    console.log(`\nLatency Percentiles (ms):`);
    console.log(`  P50: ${p50?.toFixed(2) || 'N/A'}`);
    console.log(`  P95: ${p95?.toFixed(2) || 'N/A'}`);
    console.log(`  P99: ${p99?.toFixed(2) || 'N/A'}`);
    
    if (this.results.errors.length > 0) {
      console.log('\nTop Errors:');
      const errorCounts = {};
      this.results.errors.forEach(e => {
        errorCounts[e] = (errorCounts[e] || 0) + 1;
      });
      Object.entries(errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([error, count]) => {
          console.log(`  ${error}: ${count}`);
        });
    }
    
    // Performance assertions for Pi
    console.log('\n=== Pi Performance Targets ===');
    console.log(`✓ P95 < 100ms: ${p95 < 100 ? 'PASS' : 'FAIL'}`);
    console.log(`✓ Success > 99%: ${this.results.success/this.results.requests > 0.99 ? 'PASS' : 'FAIL'}`);
    console.log(`✓ Memory < 100MB: ${this.checkMemory() ? 'PASS' : 'FAIL'}`);
  }
  
  checkMemory() {
    const used = process.memoryUsage();
    const heapMB = used.heapUsed / 1024 / 1024;
    console.log(`  Heap: ${heapMB.toFixed(2)} MB`);
    return heapMB < 100;
  }
}

// Run if called directly
if (require.main === module) {
  const runner = new StressTestRunner();
  
  // Warm up
  console.log('Warming up...');
  runner.runTest(5000, 5).then(() => {
    runner.results = {
      requests: 0,
      success: 0,
      failed: 0,
      latencies: [],
      errors: []
    };
    
    // Main test
    console.log('\nRunning main test...');
    return runner.runTest(60000, 10);
  }).then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = StressTestRunner;
```

---

## GitHub Actions CI

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [20.x, 21.x]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run unit tests
      run: npm run test:unit
    
    - name: Run integration tests
      run: npm run test:integration
    
    - name: Run E2E tests
      run: npm run test:e2e
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
    
    - name: Run stress test
      run: |
        npm run test:mock-server &
        sleep 5
        npm run test:stress
```

---

## Local Testing Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e

# Run stress test
npm run test:mock-server &
npm run test:stress

# Watch mode for development
npm run test:watch

# Debug specific test
node --inspect-brk ./node_modules/.bin/jest --runInBand test/unit/lots.test.js
```

---

## Test Coverage Report

Expected coverage targets:
- **Statements**: 85%+
- **Branches**: 80%+
- **Functions**: 85%+
- **Lines**: 85%+

Critical paths requiring 100% coverage:
- LOFO deduction logic
- Atomic write operations
- P/L calculations
- Data reconciliation

---

## Validation Checklist

✅ **Unit Tests**
- [ ] LOFO algorithm correctness
- [ ] Sequential ID generation
- [ ] P/L calculation accuracy
- [ ] Atomic write reliability

✅ **Integration Tests**
- [ ] API endpoint responses
- [ ] HTX client retry logic
- [ ] State persistence
- [ ] Error recovery

✅ **E2E Tests**
- [ ] Full data pull cycle
- [ ] Failure recovery
- [ ] Data consistency
- [ ] Performance targets

✅ **Stress Tests**
- [ ] 10 RPS sustained
- [ ] P95 latency < 100ms
- [ ] Memory < 100MB
- [ ] 99%+ success rate

This comprehensive test suite ensures the HTX Pi Monitor will perform reliably when deployed to Raspberry Pi hardware.