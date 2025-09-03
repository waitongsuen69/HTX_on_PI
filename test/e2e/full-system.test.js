/**
 * End-to-End System Tests
 * Tests complete workflows from data ingestion to API output
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;
const Server = require('../../src/server');
const HTXClient = require('../../src/htx');
const HTXMockServer = require('../mocks/htx-mock-server');

describe('Full System E2E Tests', () => {
  let server = null;
  let app;
  let mockServer = null;
  let tempDir;
  let htxClient;
  let mockPort;

  beforeAll(async () => {
    // Setup temporary directory
    tempDir = await global.testUtils.createTempDir();
    
    // Start mock HTX server on random port to avoid conflicts
    mockServer = new HTXMockServer(0); // Let OS choose available port
    await mockServer.start();
    mockPort = mockServer.server.address().port;
    
    // Setup environment for integration
    process.env.DATA_DIR = tempDir;
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';
    process.env.HTX_ACCESS_KEY = 'test_key';
    process.env.HTX_SECRET_KEY = 'test_secret';
    process.env.HTX_ACCOUNT_ID = '123456';
    process.env.HTX_BASE_URL = `http://localhost:${mockPort}`;
    process.env.PULL_INTERVAL_MS = '2000'; // Fast for testing
    
    // Create server with mocked HTX client
    server = new Server();
    app = server.app;
    
    // Initialize components
    await server.stateManager.loadState();
    
    // Create HTX client pointing to mock server
    htxClient = new HTXClient(
      'test_key',
      'test_secret', 
      '123456',
      {
        baseURL: `http://localhost:${mockPort}`,
        timeout: 5000,
        maxRetries: 1,
        baseDelay: 100
      }
    );
  });

  afterAll(async () => {
    if (server.server) {
      await server.stop();
    }
    if (mockServer) {
      await mockServer.stop();
    }
    await global.testUtils.cleanupTempDir(tempDir);
  });

  describe('Complete Data Flow', () => {
    test('Should fetch data from HTX and create portfolio snapshot', async () => {
      // Reset mock server to known state
      await request(`http://localhost:${mockPort}`)
        .post('/mock/reset')
        .expect(200);

      // Configure mock data
      await request(`http://localhost:${mockPort}`)
        .post('/mock/config')
        .send({
          balances: {
            BTC: 0.5,
            ETH: 2.0,
            USDT: 1500
          },
          prices: {
            btcusdt: { open: 60000, close: 62000, high: 63000, low: 59000 },
            ethusdt: { open: 3400, close: 3500, high: 3600, low: 3300 }
          }
        })
        .expect(200);

      // Test HTX client data fetching
      const balances = await htxClient.getBalances();
      expect(balances).toEqual({
        BTC: { free: 0.5, locked: 0 },
        ETH: { free: 2.0, locked: 0 },
        USDT: { free: 1500, locked: 0 }
      });

      const prices = await htxClient.getPrices(['BTC', 'ETH', 'USDT']);
      expect(prices.BTC).toMatchObject({
        last: 62000,
        change24h: expect.any(Number)
      });

      // Create and save a snapshot
      const snapshot = server.calculator.computeSnapshot(balances, prices, {});
      await server.stateManager.saveSnapshot(snapshot);

      // Verify snapshot was saved
      const latest = server.stateManager.getLatestSnapshot();
      expect(latest).toMatchObject({
        time: expect.any(Number),
        total_value_usd: expect.any(Number),
        positions: expect.arrayContaining([
          expect.objectContaining({
            symbol: 'BTC',
            value: 31000 // 0.5 * 62000
          }),
          expect.objectContaining({
            symbol: 'ETH',
            value: 7000 // 2.0 * 3500
          })
        ])
      });

      expect(latest.total_value_usd).toBeCloseTo(39500, 0); // 31000 + 7000 + 1500
    });

    test('Should handle LOFO accounting with real trading scenario', async () => {
      // Setup initial lots data
      const lotsData = {
        meta: { last_id: 3 },
        BTC: {
          lots: [
            { id: '000001', action: 'buy', qty: 0.3, unit_cost: 58000, ts: '2024-01-15T10:30:00Z' },
            { id: '000002', action: 'buy', qty: 0.4, unit_cost: 65000, ts: '2024-01-20T14:15:00Z' },
            { id: '000003', action: 'deposit', qty: 0.2, unit_cost: null, ts: '2024-01-10T08:00:00Z' }
          ]
        }
      };

      // Save lots data
      await server.lotsManager.saveLotsAtomic(lotsData);

      // Simulate selling some BTC (LOFO deduction)
      const sellEntry = {
        action: 'sell',
        qty: 0.5,
        ts: '2024-01-25T12:00:00Z'
      };

      server.lotsManager.applyEntry(lotsData, 'BTC', sellEntry);
      await server.lotsManager.saveLotsAtomic(lotsData);

      // Verify LOFO deduction occurred correctly
      const updatedLots = await server.lotsManager.loadLots();
      const btcLots = updatedLots.BTC.lots;
      
      // First lot (58000) should be fully consumed
      // Second lot (65000) should be partially consumed: 0.4 - 0.2 = 0.2
      // Deposit (null cost) should be unchanged
      
      const remainingBuyLots = btcLots.filter(lot => lot.qty > 0 && lot.unit_cost !== null);
      expect(remainingBuyLots).toHaveLength(1);
      expect(remainingBuyLots[0]).toMatchObject({
        unit_cost: 65000,
        qty: 0.2 // Partially consumed
      });

      // Should have sell record
      const sellRecord = btcLots.find(lot => lot.action === 'sell');
      expect(sellRecord).toMatchObject({
        action: 'sell',
        qty: -0.5,
        unit_cost: null
      });
    });

    test('Should calculate P/L correctly with cost basis', async () => {
      // Setup portfolio with known cost basis
      const balances = {
        BTC: { free: 1.0, locked: 0 },
        ETH: { free: 5.0, locked: 0 }
      };

      const prices = {
        BTC: { last: 70000, change24h: 5.0 },
        ETH: { last: 4000, change24h: 8.0 }
      };

      const lotsData = {
        meta: { last_id: 2 },
        BTC: {
          lots: [
            { id: '000001', action: 'buy', qty: 1.0, unit_cost: 60000, ts: '2024-01-01T00:00:00Z' }
          ]
        },
        ETH: {
          lots: [
            { id: '000002', action: 'buy', qty: 5.0, unit_cost: 3200, ts: '2024-01-01T00:00:00Z' }
          ]
        }
      };

      const snapshot = server.calculator.computeSnapshot(balances, prices, lotsData);

      // Verify P/L calculations
      const btcPosition = snapshot.positions.find(p => p.symbol === 'BTC');
      const ethPosition = snapshot.positions.find(p => p.symbol === 'ETH');

      expect(btcPosition.pnl_pct).toBeCloseTo(16.67, 1); // (70000/60000 - 1) * 100
      expect(ethPosition.pnl_pct).toBeCloseTo(25.0, 1); // (4000/3200 - 1) * 100

      expect(btcPosition.avg_cost).toBe(60000);
      expect(ethPosition.avg_cost).toBe(3200);
    });

    test('Should detect reconciliation issues', async () => {
      const balances = {
        BTC: { free: 1.5, locked: 0 }, // Exchange shows 1.5 BTC
        ETH: { free: 2.0, locked: 0 }
      };

      const lotsData = {
        meta: { last_id: 1 },
        BTC: {
          lots: [
            { id: '000001', action: 'buy', qty: 1.0, unit_cost: 60000, ts: '2024-01-01T00:00:00Z' }
          ]
        } // Lots only show 1.0 BTC - reconciliation issue
      };

      const prices = {
        BTC: { last: 65000, change24h: 2.0 },
        ETH: { last: 3500, change24h: 1.0 }
      };

      const snapshot = server.calculator.computeSnapshot(balances, prices, lotsData);

      const btcPosition = snapshot.positions.find(p => p.symbol === 'BTC');
      const ethPosition = snapshot.positions.find(p => p.symbol === 'ETH');

      expect(btcPosition.unreconciled).toBe(true); // Mismatch detected
      expect(ethPosition.unreconciled).toBe(true); // No lots data for ETH
    });

    test('Should persist state atomically under concurrent access', async () => {
      // Clear existing state to avoid pollution from previous tests
      server.stateManager.cache.history = [];
      
      // Simulate concurrent snapshot saves
      const snapshots = Array.from({ length: 5 }, (_, i) => ({
        time: Math.floor(Date.now() / 1000) + i,
        ref_fiat: 'USD',
        total_value_usd: 10000 + i * 1000,
        total_change_24h_pct: i * 0.5,
        positions: [
          {
            symbol: 'TEST',
            free: i + 1,
            price: 100,
            value: (i + 1) * 100,
            day_pct: 0,
            pnl_pct: null,
            avg_cost: null,
            unreconciled: false
          }
        ]
      }));

      // Save all snapshots concurrently
      const promises = snapshots.map(snapshot => 
        server.stateManager.saveSnapshot(snapshot)
      );

      await Promise.all(promises);

      // Verify all snapshots were saved (newest first)
      const history = server.stateManager.getHistory(10);
      expect(history).toHaveLength(5);
      
      // Should be in reverse chronological order by save time (not timestamp)
      for (let i = 1; i < history.length; i++) {
        // Each subsequent snapshot should have a lower total_value_usd 
        // (since we saved them in order)
        expect(history[i].total_value_usd).toBeLessThan(history[i - 1].total_value_usd);
      }
    });
  });

  describe('API Integration Flow', () => {
    test('Should provide complete API workflow', async () => {
      // 1. Check system health
      const healthResponse = await request(app)
        .get('/api/health')
        .expect(200);

      expect(healthResponse.body.ok).toBe(true);

      // 2. Get current snapshot
      const snapshotResponse = await request(app)
        .get('/api/snapshot')
        .expect(200);

      expect(snapshotResponse.body).toMatchObject({
        time: expect.any(Number),
        total_value_usd: expect.any(Number),
        positions: expect.any(Array)
      });

      // 3. Get historical data
      const historyResponse = await request(app)
        .get('/api/history?n=5')
        .expect(200);

      expect(historyResponse.body.history).toHaveLength(5);

      // 4. Check system status
      const statusResponse = await request(app)
        .get('/api/status')
        .expect(200);

      expect(statusResponse.body).toMatchObject({
        server: expect.any(Object),
        memory: expect.any(Object),
        state: expect.any(Object)
      });

      // Verify data consistency across endpoints
      expect(snapshotResponse.body.time).toBe(historyResponse.body.history[0].time);
      expect(statusResponse.body.state.totalSnapshots).toBeGreaterThan(0);
    });

    test('Should handle portfolio performance calculations', async () => {
      // Create snapshots with performance data
      const baseTime = Math.floor(Date.now() / 1000);
      const performanceSnapshots = [
        {
          time: baseTime - 2,
          ref_fiat: 'USD',
          total_value_usd: 40000,
          total_change_24h_pct: -2.0,
          positions: [
            { symbol: 'BTC', free: 0.5, price: 60000, value: 30000, day_pct: -2.0, pnl_pct: 0, avg_cost: 60000, unreconciled: false },
            { symbol: 'USDT', free: 10000, price: 1.0, value: 10000, day_pct: 0, pnl_pct: null, avg_cost: null, unreconciled: false }
          ]
        },
        {
          time: baseTime - 1,
          ref_fiat: 'USD',
          total_value_usd: 42000,
          total_change_24h_pct: 3.0,
          positions: [
            { symbol: 'BTC', free: 0.5, price: 64000, value: 32000, day_pct: 6.7, pnl_pct: 6.7, avg_cost: 60000, unreconciled: false },
            { symbol: 'USDT', free: 10000, price: 1.0, value: 10000, day_pct: 0, pnl_pct: null, avg_cost: null, unreconciled: false }
          ]
        },
        {
          time: baseTime,
          ref_fiat: 'USD',
          total_value_usd: 44000,
          total_change_24h_pct: 1.5,
          positions: [
            { symbol: 'BTC', free: 0.5, price: 68000, value: 34000, day_pct: 6.3, pnl_pct: 13.3, avg_cost: 60000, unreconciled: false },
            { symbol: 'USDT', free: 10000, price: 1.0, value: 10000, day_pct: 0, pnl_pct: null, avg_cost: null, unreconciled: false }
          ]
        }
      ];

      // Save performance snapshots
      for (const snapshot of performanceSnapshots) {
        await server.stateManager.saveSnapshot(snapshot);
      }

      // Test portfolio statistics calculation
      const latest = server.stateManager.getLatestSnapshot();
      const stats = server.calculator.calculatePortfolioStats(latest.positions);

      expect(stats).toMatchObject({
        totalPositions: 2,
        withPnL: 1, // Only BTC has P/L
        withoutPnL: 1, // USDT has no cost basis
        reconciled: 2, // Both positions reconciled
        unreconciled: 0
      });

      // Test historical metrics
      const history = server.stateManager.getHistory(3);
      const metrics = server.calculator.calculateHistoricalMetrics(history);

      expect(metrics).toMatchObject({
        dataPoints: 3,
        periodReturn: 10.0, // (44000/40000 - 1) * 100
        maxValue: 44000,
        minValue: 40000,
        avgValue: 42000
      });
    });
  });

  describe('Error Handling and Recovery', () => {
    test('Should handle HTX API errors gracefully', async () => {
      // Configure mock to return errors
      await request(`http://localhost:${mockPort}`)
        .post('/mock/config')
        .send({
          errorMode: { type: 'http', code: 500, message: 'Internal Server Error' }
        })
        .expect(200);

      // HTX client should handle the error
      await expect(htxClient.getBalances()).rejects.toThrow();

      // Reset error mode
      await request(`http://localhost:${mockPort}`)
        .post('/mock/config')
        .send({ errorMode: null })
        .expect(200);

      // Should work again
      const balances = await htxClient.getBalances();
      expect(balances).toBeDefined();
    });

    test('Should handle rate limiting', async () => {
      // Enable rate limiting
      await request(`http://localhost:${mockPort}`)
        .post('/mock/config')
        .send({ rateLimitEnabled: true })
        .expect(200);

      // Make many requests to trigger rate limit
      const promises = Array.from({ length: 15 }, () => htxClient.getPrices(['BTC']));

      // Some should succeed, some should fail with rate limit
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');
      
      expect(failed.length).toBeGreaterThan(0);

      // Reset rate limiting
      await request(`http://localhost:${mockPort}`)
        .post('/mock/reset')
        .expect(200);
    });

    test('Should handle file system errors gracefully', async () => {
      // Create a scenario where atomic write might fail
      const invalidManager = server.stateManager;
      const originalWrite = invalidManager.atomicWrite;

      // Mock atomic write to fail
      invalidManager.atomicWrite = jest.fn().mockRejectedValue(new Error('Disk full'));

      try {
        const snapshot = global.testUtils.createMockSnapshot();
        await expect(invalidManager.saveSnapshot(snapshot))
          .rejects.toThrow('Disk full');
      } finally {
        // Restore original method
        invalidManager.atomicWrite = originalWrite;
      }
    });

    test('Should recover from corrupted data files', async () => {
      // Corrupt the state file
      const statePath = server.stateManager.statePath;
      await fs.writeFile(statePath, '{ corrupted json data }');

      // Create new state manager - should handle corruption gracefully
      const StateManager = require('../../src/state');
      const newManager = new StateManager(tempDir, 10);
      await newManager.loadState();

      // Should start with empty state
      expect(newManager.cache.history).toHaveLength(0);

      // Should be able to save new data
      const testSnapshot = global.testUtils.createMockSnapshot();
      await newManager.saveSnapshot(testSnapshot);
      expect(newManager.cache.history).toHaveLength(1);
    });
  });

  describe('Performance and Scalability', () => {
    test('Should handle large lots datasets efficiently', async () => {
      const { performanceTestData } = require('../fixtures/sample-data');
      
      const startTime = Date.now();
      
      // Create large lots dataset
      const largeLots = {
        meta: { last_id: performanceTestData.largeLotsList.length },
        BTC: { lots: performanceTestData.largeLotsList }
      };

      // Test LOFO deduction performance
      const deductedLots = server.lotsManager.deductLOFO(
        performanceTestData.largeLotsList, 
        500 // Deduct 500 units
      );

      const duration = Date.now() - startTime;
      
      // Should complete in reasonable time (< 100ms for 1000 lots)
      expect(duration).toBeLessThan(100);
      expect(deductedLots).toBeDefined();
      expect(Array.isArray(deductedLots)).toBe(true);
    });

    test('Should handle large snapshot history efficiently', async () => {
      const { performanceTestData } = require('../fixtures/sample-data');
      
      const startTime = Date.now();
      
      // Calculate metrics for large dataset
      const metrics = server.calculator.calculateHistoricalMetrics(
        performanceTestData.largeSnapshotHistory
      );

      const duration = Date.now() - startTime;
      
      // Should complete in reasonable time
      expect(duration).toBeLessThan(50);
      expect(metrics).toMatchObject({
        dataPoints: 100,
        periodReturn: expect.any(Number),
        volatility: expect.any(Number)
      });
    });

    test('Should maintain API response times under load', async () => {
      // Make concurrent requests to API endpoints
      const concurrentRequests = 10;
      const startTime = Date.now();

      const promises = Array.from({ length: concurrentRequests }, async (_, i) => {
        if (i % 3 === 0) {
          return request(app).get('/api/health');
        } else if (i % 3 === 1) {
          return request(app).get('/api/snapshot');
        } else {
          return request(app).get('/api/history?n=10');
        }
      });

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should succeed
      results.forEach(result => {
        expect(result.status).toBe(200);
      });

      // Should complete all requests in reasonable time
      expect(duration).toBeLessThan(1000); // 1 second for 10 concurrent requests
    });
  });
});