/**
 * API Integration Tests
 * Tests the Express server endpoints with real request/response cycles
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs').promises;
const Server = require('../../src/server');
const StateManager = require('../../src/state');
const LotsManager = require('../../src/lots');

describe('API Integration Tests', () => {
  let server;
  let app;
  let tempDir;

  beforeAll(async () => {
    tempDir = await global.testUtils.createTempDir();
    
    // Set test environment variables
    process.env.DATA_DIR = tempDir;
    process.env.PORT = '0'; // Let system choose available port
    process.env.NODE_ENV = 'test';
    
    // Clear any HTX credentials to ensure no HTX client is configured
    delete process.env.HTX_ACCESS_KEY;
    delete process.env.HTX_SECRET_KEY;
    delete process.env.HTX_ACCOUNT_ID;
    delete process.env.HTX_BASE_URL;
    
    // Create server instance without starting it (no HTX credentials)
    server = new Server();
    app = server.app;
    
    // Initialize state with some test data
    await server.stateManager.loadState();
    
    // Add some test snapshots
    const mockSnapshot1 = {
      time: Math.floor(Date.now() / 1000) - 60,
      ref_fiat: 'USD',
      total_value_usd: 45000.00,
      total_change_24h_pct: -1.2,
      positions: [
        {
          symbol: 'BTC',
          free: 0.5,
          price: 62000,
          value: 31000,
          day_pct: -1.2,
          pnl_pct: 3.5,
          avg_cost: 60000,
          unreconciled: false
        },
        {
          symbol: 'ETH',
          free: 4.0,
          price: 3500,
          value: 14000,
          day_pct: 2.1,
          pnl_pct: null,
          avg_cost: null,
          unreconciled: false
        }
      ]
    };

    const mockSnapshot2 = {
      time: Math.floor(Date.now() / 1000),
      ref_fiat: 'USD',
      total_value_usd: 46000.00,
      total_change_24h_pct: 0.8,
      positions: [
        {
          symbol: 'BTC',
          free: 0.5,
          price: 63000,
          value: 31500,
          day_pct: 1.6,
          pnl_pct: 5.0,
          avg_cost: 60000,
          unreconciled: false
        },
        {
          symbol: 'ETH',
          free: 4.0,
          price: 3625,
          value: 14500,
          day_pct: 3.6,
          pnl_pct: null,
          avg_cost: null,
          unreconciled: false
        }
      ]
    };

    await server.stateManager.saveSnapshot(mockSnapshot1);
    await server.stateManager.saveSnapshot(mockSnapshot2);
  });

  afterAll(async () => {
    if (server.server) {
      await server.stop();
    }
    await global.testUtils.cleanupTempDir(tempDir);
  });

  describe('Health Check Endpoint', () => {
    test('GET /api/health should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        ok: true,
        version: expect.any(String),
        uptime: expect.any(Number),
        lastSnapshotAt: expect.any(Number),
        cache: {
          snapshots: expect.any(Number),
          oldestTime: expect.any(Number),
          newestTime: expect.any(Number)
        }
      });

      expect(response.body.now).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
      expect(response.body.cache.snapshots).toBeGreaterThan(0);
    });

    test('Health check should include scheduler status when available', async () => {
      // Mock scheduler
      server.scheduler = {
        getHealth: jest.fn().mockReturnValue({
          healthy: true,
          issues: [],
          successRate: 0.95,
          lastSuccessAgo: 30
        })
      };

      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.scheduler).toMatchObject({
        healthy: true,
        issues: expect.any(Array),
        successRate: expect.any(Number),
        lastSuccessAgo: expect.any(Number)
      });

      // Cleanup
      server.scheduler = null;
    });

    test('Health check should handle errors gracefully', async () => {
      // Mock a failing method
      const originalMethod = server.stateManager.getLatestSnapshot;
      server.stateManager.getLatestSnapshot = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      const response = await request(app)
        .get('/api/health')
        .expect(500);

      expect(response.body).toMatchObject({
        ok: false,
        error: 'Health check failed'
      });

      // Restore
      server.stateManager.getLatestSnapshot = originalMethod;
    });
  });

  describe('Snapshot Endpoint', () => {
    test('GET /api/snapshot should return latest snapshot', async () => {
      const response = await request(app)
        .get('/api/snapshot')
        .expect(200);

      expect(response.body).toMatchObject({
        time: expect.any(Number),
        ref_fiat: 'USD',
        total_value_usd: expect.any(Number),
        total_change_24h_pct: expect.any(Number),
        positions: expect.any(Array)
      });

      expect(response.body.positions.length).toBeGreaterThan(0);
      expect(response.body.positions[0]).toMatchObject({
        symbol: expect.any(String),
        free: expect.any(Number),
        price: expect.any(Number),
        value: expect.any(Number)
      });
    });

    test('Should return 404 when no snapshots exist', async () => {
      // Create empty state manager
      const emptyManager = new StateManager(tempDir);
      const originalManager = server.stateManager;
      server.stateManager = emptyManager;

      const response = await request(app)
        .get('/api/snapshot')
        .expect(404);

      expect(response.body).toEqual({
        error: 'No snapshot available'
      });

      // Restore
      server.stateManager = originalManager;
    });

    test('Should handle internal errors gracefully', async () => {
      const originalMethod = server.stateManager.getLatestSnapshot;
      server.stateManager.getLatestSnapshot = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .get('/api/snapshot')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to retrieve snapshot'
      });

      // Restore
      server.stateManager.getLatestSnapshot = originalMethod;
    });
  });

  describe('History Endpoint', () => {
    test('GET /api/history should return historical snapshots', async () => {
      const response = await request(app)
        .get('/api/history')
        .expect(200);

      expect(response.body).toMatchObject({
        history: expect.any(Array),
        count: expect.any(Number),
        limit: 50 // Default limit
      });

      expect(response.body.history.length).toBeGreaterThan(0);
      expect(response.body.count).toBe(response.body.history.length);

      // Verify snapshot structure
      const snapshot = response.body.history[0];
      expect(snapshot).toMatchObject({
        time: expect.any(Number),
        total_value_usd: expect.any(Number),
        positions: expect.any(Array)
      });
    });

    test('Should respect limit parameter', async () => {
      const response = await request(app)
        .get('/api/history?n=1')
        .expect(200);

      expect(response.body.history).toHaveLength(1);
      expect(response.body.count).toBe(1);
      expect(response.body.limit).toBe(1);
    });

    test('Should validate and cap limit parameter', async () => {
      // Test maximum limit
      const response1 = await request(app)
        .get('/api/history?n=200') // Above max
        .expect(200);

      expect(response1.body.limit).toBe(100); // Capped

      // Test minimum limit
      const response2 = await request(app)
        .get('/api/history?n=0')
        .expect(200);

      expect(response2.body.limit).toBe(1); // Minimum

      // Test invalid limit
      const response3 = await request(app)
        .get('/api/history?n=invalid')
        .expect(200);

      expect(response3.body.limit).toBe(50); // Default
    });

    test('Should handle internal errors gracefully', async () => {
      const originalMethod = server.stateManager.getHistory;
      server.stateManager.getHistory = jest.fn().mockImplementation(() => {
        throw new Error('Storage error');
      });

      const response = await request(app)
        .get('/api/history')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to retrieve history'
      });

      // Restore
      server.stateManager.getHistory = originalMethod;
    });
  });

  describe('Status Endpoint', () => {
    test('GET /api/status should return detailed system status', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toMatchObject({
        server: {
          uptime: expect.any(Number),
          port: expect.any(Number),
          bindAddr: expect.any(String),
          nodeVersion: expect.any(String),
          platform: expect.any(String),
          pid: expect.any(Number)
        },
        memory: {
          heapUsed: expect.any(Number),
          heapTotal: expect.any(Number),
          rss: expect.any(Number)
        },
        state: {
          totalSnapshots: expect.any(Number),
          oldestTime: expect.any(Number),
          newestTime: expect.any(Number),
          cacheSize: expect.any(Number)
        },
        htx: {
          configured: false, // No HTX client in test
          connected: false
        }
      });

      expect(response.body.server.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    });

    test('Should include scheduler metrics when available', async () => {
      // Mock scheduler with detailed metrics
      server.scheduler = {
        getDetailedMetrics: jest.fn().mockReturnValue({
          totalPulls: 100,
          successfulPulls: 95,
          failedPulls: 5,
          successRate: 0.95,
          avgPullDurationMs: 1500,
          lastPullDurationMs: 1200,
          failureCount: 0,
          lastSuccessTime: Date.now() - 60000,
          lastErrorTime: null
        })
      };

      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body.scheduler).toMatchObject({
        totalPulls: 100,
        successfulPulls: 95,
        failedPulls: 5,
        successRate: 0.95
      });

      // Cleanup
      server.scheduler = null;
    });

    test('Should handle HTX client when configured', async () => {
      // Mock HTX client
      server.htxClient = {
        testConnection: jest.fn().mockResolvedValue(true)
      };
      server.testHTXConnection = jest.fn().mockResolvedValue(true);

      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body.htx).toMatchObject({
        configured: true,
        connected: true
      });

      // Cleanup
      server.htxClient = null;
    });

    test('Should handle status errors gracefully', async () => {
      const originalMethod = server.stateManager.getCacheStats;
      server.stateManager.getCacheStats = jest.fn().mockImplementation(() => {
        throw new Error('Cache error');
      });

      const response = await request(app)
        .get('/api/status')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to retrieve status'
      });

      // Restore
      server.stateManager.getCacheStats = originalMethod;
    });
  });

  describe('Refresh Endpoint', () => {
    test('POST /api/refresh should return 503 when scheduler not available', async () => {
      const response = await request(app)
        .post('/api/refresh')
        .expect(503);

      expect(response.body).toEqual({
        error: 'Scheduler not available'
      });
    });

    test('Should trigger refresh when scheduler is available', async () => {
      // Mock scheduler
      const mockForcePull = jest.fn().mockResolvedValue();
      server.scheduler = {
        forcePull: mockForcePull
      };

      const response = await request(app)
        .post('/api/refresh')
        .expect(200);

      expect(mockForcePull).toHaveBeenCalled();
      expect(response.body).toMatchObject({
        success: true,
        message: 'Refresh completed',
        snapshot: expect.any(Object)
      });

      // Cleanup
      server.scheduler = null;
    });

    test('Should handle refresh errors gracefully', async () => {
      // Mock scheduler that fails
      server.scheduler = {
        forcePull: jest.fn().mockRejectedValue(new Error('Pull failed'))
      };

      const response = await request(app)
        .post('/api/refresh')
        .expect(500);

      expect(response.body).toMatchObject({
        error: expect.stringContaining('Refresh failed: Pull failed')
      });

      // Cleanup
      server.scheduler = null;
    });
  });

  describe('Static File Serving', () => {
    test('Should serve static files from public directory', async () => {
      // Create a test static file
      const publicDir = path.join(__dirname, '../../public');
      const testFile = path.join(publicDir, 'test.txt');
      
      try {
        await fs.mkdir(publicDir, { recursive: true });
        await fs.writeFile(testFile, 'test content');

        const response = await request(app)
          .get('/test.txt')
          .expect(200);

        expect(response.text).toBe('test content');
      } finally {
        // Cleanup
        await fs.unlink(testFile).catch(() => {});
      }
    });

    test('Should serve index.html for non-API routes (SPA support)', async () => {
      // Create index.html
      const publicDir = path.join(__dirname, '../../public');
      const indexFile = path.join(publicDir, 'index.html');
      
      try {
        await fs.mkdir(publicDir, { recursive: true });
        await fs.writeFile(indexFile, '<html><body>HTX Monitor</body></html>');

        const response = await request(app)
          .get('/dashboard')
          .expect(200);

        expect(response.text).toContain('HTX Monitor');
        expect(response.headers['content-type']).toMatch(/text\/html/);
      } finally {
        // Cleanup
        await fs.unlink(indexFile).catch(() => {});
      }
    });
  });

  describe('Error Handling', () => {
    test('Should return 404 for non-existent API endpoints', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toMatchObject({
        error: 'Not found',
        path: '/api/nonexistent',
        method: 'GET'
      });
    });

    test('Should handle unsupported HTTP methods', async () => {
      const response = await request(app)
        .delete('/api/health')
        .expect(404);

      expect(response.body.method).toBe('DELETE');
    });

    test('Should handle malformed JSON in POST requests', async () => {
      const response = await request(app)
        .post('/api/refresh')
        .send('{ invalid json }')
        .set('Content-Type', 'application/json')
        .expect(400);

      // Express should handle this automatically
    });

    test('Should limit request body size', async () => {
      const largeData = 'x'.repeat(2 * 1024 * 1024); // 2MB

      const response = await request(app)
        .post('/api/refresh')
        .send({ data: largeData })
        .expect(413); // Payload too large

      // Express should handle this automatically with the 1mb limit
    });
  });

  describe('Security Headers', () => {
    test('Should include security headers via helmet', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Helmet should add these headers
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    test('Should include CSP headers', async () => {
      const response = await request(app)
        .get('/')
        .expect(404); // No index.html in test

      expect(response.headers).toHaveProperty('content-security-policy');
    });
  });

  describe('CORS Handling', () => {
    test('Should include CORS headers in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Recreate server to pick up new environment
      const devServer = new Server();

      const response = await request(devServer.app)
        .get('/api/health')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin', '*');
      
      // Restore
      process.env.NODE_ENV = originalEnv;
    });

    test('Should not include CORS headers in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Recreate server to pick up new environment
      const prodServer = new Server();

      const response = await request(prodServer.app)
        .get('/api/health')
        .expect(200);

      expect(response.headers).not.toHaveProperty('access-control-allow-origin');
      
      // Restore
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Compression and Performance', () => {
    test('Should compress responses when appropriate', async () => {
      const response = await request(app)
        .get('/api/history?n=50')
        .set('Accept-Encoding', 'gzip')
        .expect(200);

      // Response should be large enough to trigger compression
      if (response.body.history.length > 0) {
        expect(response.headers).toHaveProperty('content-encoding');
      }
    });

    test('Should have reasonable response times', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/api/health')
        .expect(200);
        
      const duration = Date.now() - startTime;
      
      // Health check should be very fast
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Content-Type Handling', () => {
    test('Should return JSON for API endpoints', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('Should handle Accept headers correctly', async () => {
      const response = await request(app)
        .get('/api/snapshot')
        .set('Accept', 'application/json')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });
});