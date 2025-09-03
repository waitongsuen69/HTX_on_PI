#!/usr/bin/env node

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

// Application modules
const HTXClient = require('./htx');
const StateManager = require('./state');
const LotsManager = require('./lots');
const Calculator = require('./calc');
const Scheduler = require('./scheduler');

/**
 * Express Server with API endpoints and middleware
 * Serves both API and static frontend files
 */
class Server {
  constructor(port, bindAddr, options = {}) {
    this.port = port || process.env.PORT || 8080;
    this.bindAddr = bindAddr || process.env.BIND_ADDR || '0.0.0.0';
    
    // Initialize components
    this.stateManager = new StateManager(
      process.env.DATA_DIR || './data',
      parseInt(process.env.MAX_HISTORY_SNAPSHOTS) || 50
    );
    
    this.lotsManager = new LotsManager(process.env.DATA_DIR || './data');
    this.calculator = new Calculator(this.lotsManager);
    
    // HTX client (if credentials provided)
    this.htxClient = null;
    if (process.env.HTX_ACCESS_KEY && process.env.HTX_SECRET_KEY && process.env.HTX_ACCOUNT_ID) {
      this.htxClient = new HTXClient(
        process.env.HTX_ACCESS_KEY,
        process.env.HTX_SECRET_KEY,
        process.env.HTX_ACCOUNT_ID
      );
    }
    
    this.scheduler = null;
    this.server = null;
    this.startTime = Date.now();
    
    // Create Express app
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for simplicity
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false // Allow for local development
    }));

    // Compression - with lower threshold for testing
    this.app.use(compression({
      threshold: 0, // Compress all responses for testing
      level: 6,
      chunkSize: 1024,
      windowBits: 13
    }));

    // Logging
    this.app.use(morgan('combined', {
      skip: (req, res) => {
        // Skip logging for health checks in production to reduce noise
        return req.url === '/api/health' && process.env.NODE_ENV === 'production';
      }
    }));

    // Body parsing with error handling
    this.app.use(express.json({
      limit: '1mb',
      strict: true,
      type: 'application/json'
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    
    // Handle JSON parsing errors
    this.app.use((error, req, res, next) => {
      if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({
          error: 'Invalid JSON format',
          timestamp: new Date().toISOString()
        });
      }
      if (error.type === 'entity.too.large') {
        return res.status(413).json({
          error: 'Request body too large',
          timestamp: new Date().toISOString()
        });
      }
      next(error);
    });

    // CORS for development
    if (process.env.NODE_ENV === 'development') {
      this.app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        next();
      });
    }

    // Static files (serve frontend)
    this.app.use(express.static(path.join(__dirname, '..', 'public'), {
      maxAge: process.env.NODE_ENV === 'production' ? '1h' : '0',
      etag: true,
      lastModified: true
    }));
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // API routes
    this.app.get('/api/health', this.handleHealth.bind(this));
    this.app.get('/api/snapshot', this.handleSnapshot.bind(this));
    this.app.get('/api/history', this.handleHistory.bind(this));
    this.app.get('/api/status', this.handleStatus.bind(this));
    this.app.post('/api/refresh', this.handleRefresh.bind(this));

    // Catch-all handler for SPA (serve index.html for any non-API route)
    this.app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api/')) {
        return next(); // Let it fall through to 404 handler
      }
      
      const indexPath = path.join(__dirname, '..', 'public', 'index.html');
      res.sendFile(indexPath, (err) => {
        if (err) {
          // If index.html doesn't exist, return 404
          next();
        }
      });
    });

    // Error handling
    this.app.use(this.errorHandler.bind(this));
    this.app.use(this.notFoundHandler.bind(this));
  }

  /**
   * Health check endpoint
   */
  async handleHealth(req, res) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const latest = this.stateManager.getLatestSnapshot();
      const cacheStats = this.stateManager.getCacheStats();
      
      const health = {
        ok: true,
        now: now,
        lastSnapshotAt: latest?.time || null,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        version: require('../package.json').version,
        cache: {
          snapshots: cacheStats.totalSnapshots,
          oldestTime: cacheStats.oldestTime,
          newestTime: cacheStats.newestTime
        }
      };

      // Add scheduler status if available
      if (this.scheduler) {
        const schedulerHealth = this.scheduler.getHealth();
        health.scheduler = {
          healthy: schedulerHealth.healthy,
          issues: schedulerHealth.issues,
          successRate: schedulerHealth.successRate,
          lastSuccessAgo: schedulerHealth.lastSuccessAgo
        };
      }

      res.json(health);
    } catch (error) {
      console.error('Health check error:', error);
      res.status(500).json({
        ok: false,
        error: 'Health check failed',
        now: Math.floor(Date.now() / 1000)
      });
    }
  }

  /**
   * Get latest snapshot
   */
  async handleSnapshot(req, res) {
    try {
      const snapshot = this.stateManager.getLatestSnapshot();
      
      if (!snapshot) {
        return res.status(404).json({
          error: 'No snapshot available'
        });
      }

      res.json(snapshot);
    } catch (error) {
      console.error('Snapshot error:', error);
      res.status(500).json({
        error: 'Failed to retrieve snapshot'
      });
    }
  }

  /**
   * Get historical snapshots
   */
  async handleHistory(req, res) {
    try {
      // Parse and validate limit parameter
      let limit = req.query.n ? parseInt(req.query.n) : 50;
      if (isNaN(limit)) limit = 50;
      if (limit <= 0) limit = 1;
      if (limit > 100) limit = 100;

      const history = this.stateManager.getHistory(limit);
      
      res.json({
        history: history,
        count: history.length,
        limit: limit
      });
    } catch (error) {
      console.error('History error:', error);
      res.status(500).json({
        error: 'Failed to retrieve history'
      });
    }
  }

  /**
   * Get detailed system status
   */
  async handleStatus(req, res) {
    try {
      const status = {
        server: {
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          port: parseInt(this.port),
          bindAddr: this.bindAddr,
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid
        },
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024) // MB
        },
        state: this.stateManager.getCacheStats(),
        htx: {
          configured: !!this.htxClient,
          connected: this.htxClient ? await this.testHTXConnection() : false
        }
      };

      // Add scheduler metrics if available
      if (this.scheduler) {
        status.scheduler = this.scheduler.getDetailedMetrics();
      }

      res.json(status);
    } catch (error) {
      console.error('Status error:', error);
      res.status(500).json({
        error: 'Failed to retrieve status'
      });
    }
  }

  /**
   * Force refresh (manual pull)
   */
  async handleRefresh(req, res) {
    try {
      if (!this.scheduler) {
        return res.status(503).json({
          error: 'Scheduler not available'
        });
      }

      // Trigger immediate pull
      await this.scheduler.forcePull();
      
      // Return latest snapshot
      const snapshot = this.stateManager.getLatestSnapshot();
      
      res.json({
        success: true,
        message: 'Refresh completed',
        snapshot: snapshot
      });
    } catch (error) {
      console.error('Refresh error:', error);
      res.status(500).json({
        error: 'Refresh failed: ' + error.message
      });
    }
  }

  /**
   * Test HTX connection
   */
  async testHTXConnection() {
    if (!this.htxClient) return false;
    
    try {
      return await this.htxClient.testConnection();
    } catch (error) {
      return false;
    }
  }

  /**
   * Error handler middleware
   */
  errorHandler(error, req, res, next) {
    console.error('Express error:', error);
    
    // Don't leak error details in production
    const message = process.env.NODE_ENV === 'production' ? 
      'Internal server error' : 
      error.message;

    res.status(500).json({
      error: message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 404 handler
   */
  notFoundHandler(req, res) {
    res.status(404).json({
      error: 'Not found',
      path: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Start server
   */
  async start() {
    return new Promise((resolve, reject) => {
      // Start HTTP server
      this.server = this.app.listen(this.port, this.bindAddr, (error) => {
        if (error) {
          return reject(error);
        }

        console.log(`HTX Pi Monitor server listening on ${this.bindAddr}:${this.port}`);
        console.log(`Frontend: http://${this.bindAddr === '0.0.0.0' ? 'localhost' : this.bindAddr}:${this.port}`);
        console.log(`API: http://${this.bindAddr === '0.0.0.0' ? 'localhost' : this.bindAddr}:${this.port}/api`);
        
        resolve();
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${this.port} is already in use`);
        } else {
          console.error('Server error:', error);
        }
        reject(error);
      });

      // Start scheduler if HTX client is configured
      if (this.htxClient) {
        this.scheduler = new Scheduler(
          this.htxClient,
          this.stateManager,
          this.lotsManager,
          this.calculator
        );
        
        this.scheduler.start().catch((error) => {
          console.error('Failed to start scheduler:', error);
        });
      } else {
        console.warn('HTX credentials not configured, scheduler disabled');
        console.warn('Set HTX_ACCESS_KEY, HTX_SECRET_KEY, and HTX_ACCOUNT_ID to enable data pulls');
      }
    });
  }

  /**
   * Stop server
   */
  async stop() {
    return new Promise((resolve) => {
      console.log('Shutting down server...');
      
      // Stop scheduler first
      if (this.scheduler) {
        this.scheduler.stop().catch(console.error);
      }

      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          console.log('Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// CLI entry point
if (require.main === module) {
  console.log('Starting HTX Pi Monitor...');
  console.log('Node.js version:', process.version);
  console.log('Platform:', process.platform);
  
  const server = new Server();
  
  // Handle shutdown signals
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start server
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = Server;