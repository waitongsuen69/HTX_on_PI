/**
 * Scheduler - Data Pull Orchestrator
 * Manages 60-second pull cycles with error recovery and backoff
 */
class Scheduler {
  constructor(htxClient, stateManager, lotsManager, calculator, options = {}) {
    this.htxClient = htxClient;
    this.stateManager = stateManager;
    this.lotsManager = lotsManager;
    this.calculator = calculator;
    
    // Configuration
    this.intervalMs = options.intervalMs || parseInt(process.env.PULL_INTERVAL_MS) || 60000;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures || 5;
    this.backoffBaseMs = options.backoffBaseMs || 30000; // 30 seconds
    this.backoffMaxMs = options.backoffMaxMs || 300000; // 5 minutes
    
    // State
    this.isRunning = false;
    this.intervalId = null;
    this.failureCount = 0;
    this.lastSuccessTime = null;
    this.lastErrorTime = null;
    this.lastError = null;
    this.nextPullTime = null;
    this.pullCount = 0;
    this.startTime = null;
    
    // Metrics
    this.metrics = {
      totalPulls: 0,
      successfulPulls: 0,
      failedPulls: 0,
      avgPullDurationMs: 0,
      lastPullDurationMs: 0
    };

    // Bind methods
    this.pullCycle = this.pullCycle.bind(this);
    this.handleShutdown = this.handleShutdown.bind(this);
  }

  /**
   * Start the scheduler
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      console.warn('Scheduler is already running');
      return;
    }

    console.log(`Starting scheduler with ${this.intervalMs}ms interval`);
    this.isRunning = true;
    this.startTime = Date.now();
    this.nextPullTime = Date.now();

    // Load initial state
    try {
      await this.stateManager.loadState();
      console.log('State manager initialized');
    } catch (error) {
      console.error('Error loading initial state:', error.message);
    }

    // Setup shutdown handlers
    process.on('SIGINT', this.handleShutdown);
    process.on('SIGTERM', this.handleShutdown);

    // Execute first pull immediately, then schedule regular pulls
    await this.pullCycle();
    this.scheduleNextPull();
  }

  /**
   * Stop the scheduler
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping scheduler...');
    this.isRunning = false;

    // Clear scheduled pulls
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    // Remove shutdown handlers
    process.removeListener('SIGINT', this.handleShutdown);
    process.removeListener('SIGTERM', this.handleShutdown);

    console.log('Scheduler stopped');
  }

  /**
   * Schedule next pull based on interval or backoff
   */
  scheduleNextPull() {
    if (!this.isRunning) {
      return;
    }

    let delay = this.intervalMs;

    // Apply backoff if we have consecutive failures
    if (this.failureCount > 0) {
      delay = Math.min(
        this.backoffBaseMs * Math.pow(1.5, this.failureCount - 1),
        this.backoffMaxMs
      );
    }

    this.nextPullTime = Date.now() + delay;
    
    console.log(`Next pull scheduled in ${(delay / 1000).toFixed(1)}s (${new Date(this.nextPullTime).toLocaleTimeString()})`);

    this.intervalId = setTimeout(() => {
      this.pullCycle();
      this.scheduleNextPull();
    }, delay);
  }

  /**
   * Execute single pull cycle
   * @returns {Promise<void>}
   */
  async pullCycle() {
    if (!this.isRunning) {
      return;
    }

    const startTime = Date.now();
    this.pullCount++;
    this.metrics.totalPulls++;

    console.log(`Starting pull cycle #${this.pullCount}`);

    try {
      // Step 1: Fetch balances
      console.log('Fetching balances...');
      const balances = await this.htxClient.getBalances();
      const symbolCount = Object.keys(balances).length;
      console.log(`Fetched ${symbolCount} balances`);

      if (symbolCount === 0) {
        throw new Error('No balances returned from HTX API');
      }

      // Step 2: Fetch prices for symbols with balances
      const symbols = Object.keys(balances);
      console.log(`Fetching prices for ${symbols.length} symbols...`);
      const prices = await this.htxClient.getPrices(symbols);
      
      const priceCount = Object.keys(prices).length;
      console.log(`Fetched ${priceCount} prices`);

      // Step 3: Load lots data
      console.log('Loading lots data...');
      const lotsData = await this.lotsManager.loadLots();

      // Step 4: Calculate snapshot
      console.log('Computing portfolio snapshot...');
      const snapshot = this.calculator.computeSnapshot(balances, prices, lotsData);

      // Step 5: Save snapshot
      console.log('Saving snapshot...');
      await this.stateManager.saveSnapshot(snapshot);

      // Success!
      const duration = Date.now() - startTime;
      this.onPullSuccess(duration, snapshot);

    } catch (error) {
      const duration = Date.now() - startTime;
      if (process.env.DEBUG === 'true') {
        console.error(`[SCHEDULER DEBUG] Full error object:`, {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
      }
      this.onPullError(error, duration);
    }
  }

  /**
   * Handle successful pull
   * @param {number} duration - Pull duration in ms
   * @param {Object} snapshot - Generated snapshot
   */
  onPullSuccess(duration, snapshot) {
    this.failureCount = 0;
    this.lastSuccessTime = Date.now();
    this.lastError = null;
    
    // Update metrics
    this.metrics.successfulPulls++;
    this.metrics.lastPullDurationMs = duration;
    this.updateAvgDuration(duration);

    console.log(`Pull cycle #${this.pullCount} completed successfully in ${duration}ms`);
    console.log(`Portfolio value: $${snapshot.total_value_usd.toFixed(2)}, positions: ${snapshot.positions.length}`);
    
    // Log reconciliation issues if any
    const unreconciled = snapshot.positions.filter(p => p.unreconciled);
    if (unreconciled.length > 0) {
      console.warn(`Warning: ${unreconciled.length} unreconciled positions: ${unreconciled.map(p => p.symbol).join(', ')}`);
    }
  }

  /**
   * Handle pull error with backoff strategy
   * @param {Error} error - The error that occurred
   * @param {number} duration - Time spent before error
   */
  onPullError(error, duration) {
    this.failureCount++;
    this.lastErrorTime = Date.now();
    this.lastError = error.message;
    
    // Update metrics
    this.metrics.failedPulls++;
    this.metrics.lastPullDurationMs = duration;
    this.updateAvgDuration(duration);

    const backoffMs = Math.min(
      this.backoffBaseMs * Math.pow(1.5, this.failureCount - 1),
      this.backoffMaxMs
    );

    console.error(`Pull cycle #${this.pullCount} failed after ${duration}ms (failure #${this.failureCount}):`, error.message);
    console.error(`Will retry in ${(backoffMs / 1000).toFixed(1)}s`);

    // Check if we should alert about consecutive failures
    if (this.failureCount >= this.maxConsecutiveFailures) {
      console.error(`CRITICAL: ${this.failureCount} consecutive pull failures! System may be unhealthy.`);
    }
  }

  /**
   * Update average duration metric
   * @param {number} duration - Latest duration
   */
  updateAvgDuration(duration) {
    if (this.metrics.totalPulls === 1) {
      this.metrics.avgPullDurationMs = duration;
    } else {
      // Exponential moving average with alpha = 0.1
      this.metrics.avgPullDurationMs = Math.round(
        this.metrics.avgPullDurationMs * 0.9 + duration * 0.1
      );
    }
  }

  /**
   * Get scheduler status
   * @returns {Object} - Current status
   */
  getStatus() {
    const now = Date.now();
    const uptime = this.startTime ? now - this.startTime : 0;
    
    return {
      isRunning: this.isRunning,
      uptime: uptime,
      pullCount: this.pullCount,
      failureCount: this.failureCount,
      lastSuccessTime: this.lastSuccessTime,
      lastErrorTime: this.lastErrorTime,
      lastError: this.lastError,
      nextPullTime: this.nextPullTime,
      nextPullIn: this.nextPullTime ? Math.max(0, this.nextPullTime - now) : null,
      metrics: { ...this.metrics },
      intervalMs: this.intervalMs,
      isHealthy: this.failureCount < this.maxConsecutiveFailures
    };
  }

  /**
   * Get health check information
   * @returns {Object} - Health status
   */
  getHealth() {
    const now = Date.now();
    const status = this.getStatus();
    
    // Determine health based on recent activity
    let healthy = true;
    let issues = [];

    // Check if scheduler is running
    if (!this.isRunning) {
      healthy = false;
      issues.push('Scheduler is not running');
    }

    // Check for consecutive failures
    if (this.failureCount >= this.maxConsecutiveFailures) {
      healthy = false;
      issues.push(`${this.failureCount} consecutive failures`);
    }

    // Check if last success was too long ago
    const maxStaleMs = this.intervalMs * 3; // 3 intervals
    if (this.lastSuccessTime && (now - this.lastSuccessTime) > maxStaleMs) {
      healthy = false;
      issues.push(`No successful pull for ${Math.round((now - this.lastSuccessTime) / 1000)}s`);
    }

    // Check success rate
    const successRate = status.metrics.totalPulls > 0 ? 
      (status.metrics.successfulPulls / status.metrics.totalPulls) : 0;
    
    if (status.metrics.totalPulls > 10 && successRate < 0.8) {
      healthy = false;
      issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
    }

    return {
      healthy,
      issues,
      successRate: successRate,
      totalPulls: status.metrics.totalPulls,
      lastSuccessAgo: this.lastSuccessTime ? now - this.lastSuccessTime : null,
      avgDurationMs: status.metrics.avgPullDurationMs
    };
  }

  /**
   * Force immediate pull (for manual refresh)
   * @returns {Promise<void>}
   */
  async forcePull() {
    console.log('Forcing immediate pull...');
    
    // Clear any scheduled pull
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    // Execute pull
    await this.pullCycle();

    // Reschedule normal pulls
    if (this.isRunning) {
      this.scheduleNextPull();
    }
  }

  /**
   * Handle shutdown signals
   * @param {string} signal - Signal received
   */
  async handleShutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    
    try {
      await this.stop();
      
      // Cleanup temp files
      if (this.stateManager && typeof this.stateManager.cleanupTempFiles === 'function') {
        await this.stateManager.cleanupTempFiles();
      }
      
      console.log('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error.message);
      process.exit(1);
    }
  }

  /**
   * Reset failure count (for manual recovery)
   */
  resetFailures() {
    console.log('Resetting failure count');
    this.failureCount = 0;
    this.lastError = null;
    this.lastErrorTime = null;
  }

  /**
   * Get detailed metrics for monitoring
   * @returns {Object} - Detailed metrics
   */
  getDetailedMetrics() {
    const status = this.getStatus();
    const health = this.getHealth();
    const now = Date.now();
    
    return {
      scheduler: status,
      health: health,
      memory: {
        heapUsed: process.memoryUsage().heapUsed / 1024 / 1024, // MB
        heapTotal: process.memoryUsage().heapTotal / 1024 / 1024, // MB
        rss: process.memoryUsage().rss / 1024 / 1024 // MB
      },
      system: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
      },
      timestamp: now
    };
  }
}

module.exports = Scheduler;