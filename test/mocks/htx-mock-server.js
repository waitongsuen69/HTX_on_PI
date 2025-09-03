/**
 * Mock HTX Server for Testing
 * Simulates HTX API responses for comprehensive testing
 */

const express = require('express');
const crypto = require('crypto');

class HTXMockServer {
  constructor(port = 3001) {
    this.port = port;
    this.app = express();
    this.server = null;
    
    // Mock data
    this.mockData = {
      balances: {
        BTC: 0.5,
        ETH: 2.5,
        USDT: 1000.0,
        BNB: 10.0,
        ADA: 100.0
      },
      prices: {
        btcusdt: { open: 62750, close: 62000, high: 63500, low: 60000 },
        ethusdt: { open: 3430, close: 3500, high: 3600, low: 3300 },
        bnbusdt: { open: 454, close: 450, high: 465, low: 440 },
        adausdt: { open: 0.52, close: 0.51, high: 0.54, low: 0.50 }
      }
    };
    
    // Request tracking
    this.requestCount = 0;
    this.lastRequestTime = null;
    this.rateLimitEnabled = false;
    this.errorMode = null;
    this.delayMs = 0;
    
    this.setupRoutes();
  }

  setupRoutes() {
    // Middleware
    this.app.use(express.json());
    this.app.use(this.requestTracker.bind(this));
    this.app.use(this.rateLimitHandler.bind(this));
    this.app.use(this.errorHandler.bind(this));
    this.app.use(this.delayHandler.bind(this));

    // Common endpoints
    this.app.get('/v1/common/timestamp', this.handleTimestamp.bind(this));
    
    // Account endpoints
    this.app.get('/v1/account/accounts/:accountId/balance', this.handleBalance.bind(this));
    
    // Market data endpoints
    this.app.get('/market/tickers', this.handleTickers.bind(this));
    
    // Status endpoint for testing
    this.app.get('/mock/status', this.handleMockStatus.bind(this));
    this.app.post('/mock/config', this.handleMockConfig.bind(this));
    this.app.post('/mock/reset', this.handleMockReset.bind(this));
  }

  // Middleware functions
  requestTracker(req, res, next) {
    this.requestCount++;
    this.lastRequestTime = Date.now();
    console.log(`[HTX Mock] ${req.method} ${req.path} - Request #${this.requestCount}`);
    next();
  }

  rateLimitHandler(req, res, next) {
    // Skip rate limiting for mock control endpoints
    if (req.path.startsWith('/mock/')) {
      return next();
    }
    
    if (this.rateLimitEnabled && this.requestCount > 10) {
      return res.status(429).json({
        status: 'error',
        err_code: 'too-many-requests',
        err_msg: 'Too many requests'
      });
    }
    next();
  }

  errorHandler(req, res, next) {
    // Skip error simulation for mock control endpoints
    if (req.path.startsWith('/mock/')) {
      return next();
    }
    
    if (this.errorMode) {
      const { type, code = 500, message = 'Mock error' } = this.errorMode;
      
      switch (type) {
        case 'network':
          // Simulate network error by closing connection
          res.socket.destroy();
          return;
        case 'timeout':
          // Just hang the request (timeout will occur on client side)
          return;
        case 'http':
          return res.status(code).json({
            status: 'error',
            err_code: 'mock-error',
            err_msg: message
          });
        case 'invalid-json':
          return res.status(200).send('{ invalid json response }');
      }
    }
    next();
  }

  async delayHandler(req, res, next) {
    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }
    next();
  }

  // API handlers
  handleTimestamp(req, res) {
    res.json({
      status: 'ok',
      data: Date.now()
    });
  }

  handleBalance(req, res) {
    const { accountId } = req.params;
    
    // Validate signature (basic check)
    if (!this.validateSignature(req)) {
      return res.status(401).json({
        status: 'error',
        err_code: 'invalid-signature',
        err_msg: 'Invalid signature'
      });
    }

    // Convert balances to HTX format
    const balanceList = Object.entries(this.mockData.balances)
      .filter(([, balance]) => balance > 0)
      .map(([currency, balance]) => ({
        currency: currency.toLowerCase(),
        type: 'trade',
        balance: balance.toString()
      }));

    res.json({
      status: 'ok',
      data: {
        id: parseInt(accountId),
        type: 'spot',
        list: balanceList
      }
    });
  }

  handleTickers(req, res) {
    // Convert prices to HTX ticker format
    const tickers = Object.entries(this.mockData.prices).map(([symbol, price]) => ({
      symbol,
      open: price.open.toString(),
      close: price.close.toString(),
      high: price.high.toString(),
      low: price.low.toString(),
      amount: '1000.123', // Mock volume
      vol: '62000000.456', // Mock volume in quote currency
      count: 12345, // Mock trade count
      bid: (price.close - 1).toString(),
      ask: (price.close + 1).toString()
    }));

    res.json({
      status: 'ok',
      data: tickers,
      ts: Date.now()
    });
  }

  // Mock control endpoints
  handleMockStatus(req, res) {
    res.json({
      server: 'htx-mock',
      version: '1.0.0',
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      rateLimitEnabled: this.rateLimitEnabled,
      errorMode: this.errorMode,
      delayMs: this.delayMs,
      mockData: this.mockData
    });
  }

  handleMockConfig(req, res) {
    const { rateLimitEnabled, errorMode, delayMs, balances, prices } = req.body;
    
    if (typeof rateLimitEnabled === 'boolean') {
      this.rateLimitEnabled = rateLimitEnabled;
    }
    
    if (errorMode !== undefined) {
      this.errorMode = errorMode;
    }
    
    if (typeof delayMs === 'number') {
      this.delayMs = delayMs;
    }
    
    if (balances) {
      this.mockData.balances = balances; // Replace completely instead of merging
    }
    
    if (prices) {
      this.mockData.prices = prices; // Replace completely instead of merging
    }

    res.json({
      success: true,
      message: 'Configuration updated',
      config: {
        rateLimitEnabled: this.rateLimitEnabled,
        errorMode: this.errorMode,
        delayMs: this.delayMs
      }
    });
  }

  handleMockReset(req, res) {
    this.requestCount = 0;
    this.lastRequestTime = null;
    this.rateLimitEnabled = false;
    this.errorMode = null;
    this.delayMs = 0;
    
    // Reset to default mock data
    this.mockData = {
      balances: {
        BTC: 0.5,
        ETH: 2.5,
        USDT: 1000.0,
        BNB: 10.0,
        ADA: 100.0
      },
      prices: {
        btcusdt: { open: 62750, close: 62000, high: 63500, low: 60000 },
        ethusdt: { open: 3430, close: 3500, high: 3600, low: 3300 },
        bnbusdt: { open: 454, close: 450, high: 465, low: 440 },
        adausdt: { open: 0.52, close: 0.51, high: 0.54, low: 0.50 }
      }
    };

    res.json({
      success: true,
      message: 'Mock server reset'
    });
  }

  // Signature validation (simplified for testing)
  validateSignature(req) {
    const { query } = req;
    
    // Must have signature parameters
    const requiredParams = ['AccessKeyId', 'SignatureMethod', 'SignatureVersion', 'Timestamp', 'Signature'];
    for (const param of requiredParams) {
      if (!query[param]) {
        console.log(`[HTX Mock] Missing signature parameter: ${param}`);
        return false;
      }
    }

    // Basic validation (not cryptographically secure, just for testing)
    if (query.SignatureMethod !== 'HmacSHA256') {
      console.log('[HTX Mock] Invalid signature method');
      return false;
    }

    if (query.SignatureVersion !== '2') {
      console.log('[HTX Mock] Invalid signature version');
      return false;
    }

    // In a real implementation, we would verify the HMAC signature
    // For testing, we just check that a signature is present
    if (!query.Signature || query.Signature.length < 10) {
      console.log('[HTX Mock] Invalid signature format');
      return false;
    }

    return true;
  }

  // Utility methods for testing
  updateBalance(symbol, balance) {
    this.mockData.balances[symbol.toUpperCase()] = balance;
  }

  updatePrice(symbol, priceData) {
    const key = `${symbol.toLowerCase()}usdt`;
    this.mockData.prices[key] = { ...this.mockData.prices[key], ...priceData };
  }

  setErrorMode(errorMode) {
    this.errorMode = errorMode;
  }

  setRateLimit(enabled) {
    this.rateLimitEnabled = enabled;
  }

  setDelay(ms) {
    this.delayMs = ms;
  }

  // Server lifecycle
  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`HTX Mock Server listening on port ${this.port}`);
          console.log(`Status: http://localhost:${this.port}/mock/status`);
          resolve();
        }
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('HTX Mock Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Test scenarios
  async simulateMarketMovement(duration = 5000) {
    console.log('[HTX Mock] Starting market movement simulation...');
    
    const symbols = Object.keys(this.mockData.prices);
    const interval = 1000; // Update every second
    const iterations = duration / interval;
    
    for (let i = 0; i < iterations; i++) {
      symbols.forEach(symbol => {
        const price = this.mockData.prices[symbol];
        const volatility = 0.02; // 2% max change per second
        const change = (Math.random() - 0.5) * volatility;
        
        const newClose = price.close * (1 + change);
        price.close = Math.max(newClose, 0.001); // Minimum price
        price.high = Math.max(price.high, price.close);
        price.low = Math.min(price.low, price.close);
      });
      
      if (i < iterations - 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    console.log('[HTX Mock] Market movement simulation complete');
  }

  getMetrics() {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      uptime: Date.now() - (this.lastRequestTime || Date.now()),
      rateLimitEnabled: this.rateLimitEnabled,
      errorMode: this.errorMode,
      delayMs: this.delayMs
    };
  }
}

// CLI usage
if (require.main === module) {
  const port = process.argv[2] || 3001;
  const server = new HTXMockServer(port);
  
  server.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down HTX Mock Server...');
    await server.stop();
    process.exit(0);
  });
  
  // Simulate market movement every 30 seconds
  setInterval(() => {
    server.simulateMarketMovement(5000).catch(console.error);
  }, 30000);
}

module.exports = HTXMockServer;