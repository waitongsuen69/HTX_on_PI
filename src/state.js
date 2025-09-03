const fs = require('fs').promises;
const path = require('path');

/**
 * State Manager with in-memory cache and atomic JSON persistence
 * Handles rolling snapshot history with atomic write operations
 */
class StateManager {
  constructor(dataDir = './data', maxHistory = 50) {
    this.dataDir = dataDir;
    this.maxHistory = parseInt(maxHistory) || 50;
    this.statePath = path.join(dataDir, 'state.json');
    
    // In-memory cache
    this.cache = {
      history: []
    };
    
    // Data directory will be created on first write
  }

  /**
   * Ensure data directory exists
   */
  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Load state from disk into memory cache
   * @returns {Promise<void>}
   */
  async loadState() {
    try {
      const data = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Validate structure
      if (parsed && Array.isArray(parsed.history)) {
        this.cache = parsed;
        console.log(`Loaded ${this.cache.history.length} snapshots from disk`);
      } else {
        console.warn('Invalid state file format, starting fresh');
        this.cache = { history: [] };
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No existing state file, starting fresh');
        this.cache = { history: [] };
      } else {
        console.error('Error loading state:', error.message);
        this.cache = { history: [] };
      }
    }
  }

  /**
   * Save snapshot to memory cache and persist atomically
   * @param {Object} snapshot - Portfolio snapshot
   * @returns {Promise<void>}
   */
  async saveSnapshot(snapshot) {
    // Validate snapshot structure
    if (!this.validateSnapshot(snapshot)) {
      throw new Error('Invalid snapshot format');
    }

    // Add to memory cache (newest first)
    this.cache.history.unshift(snapshot);
    
    // Maintain rolling history limit
    if (this.cache.history.length > this.maxHistory) {
      this.cache.history = this.cache.history.slice(0, this.maxHistory);
    }

    // Ensure data directory exists before writing
    await this.ensureDataDir();
    
    // Persist atomically to disk
    await this.atomicWrite(this.statePath, this.cache);
    
    console.log(`Saved snapshot: ${snapshot.positions?.length || 0} positions, total: $${snapshot.total_value_usd?.toFixed(2) || '0.00'}`);
  }

  /**
   * Get latest snapshot from memory cache
   * @returns {Object|null} - Latest snapshot or null if none
   */
  getLatestSnapshot() {
    return this.cache.history[0] || null;
  }

  /**
   * Get history snapshots from memory cache
   * @param {number} limit - Maximum number of snapshots to return
   * @returns {Array} - Array of snapshots (newest first)
   */
  getHistory(limit = this.maxHistory) {
    const actualLimit = Math.min(limit, this.cache.history.length);
    return this.cache.history.slice(0, actualLimit);
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getCacheStats() {
    const history = this.cache.history;
    const latestSnapshot = history[0];
    
    return {
      totalSnapshots: history.length,
      oldestTime: history[history.length - 1]?.time || null,
      newestTime: latestSnapshot?.time || null,
      lastSnapshotAt: latestSnapshot?.time || null,
      cacheSize: JSON.stringify(this.cache).length
    };
  }

  /**
   * Atomic write operation using temp file + rename pattern
   * Prevents corruption on power loss or crashes
   * @param {string} filepath - Target file path
   * @param {Object} data - Data to write
   * @returns {Promise<void>}
   */
  async atomicWrite(filepath, data) {
    // Create unique temp file name
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const tmpPath = `${filepath}.tmp.${timestamp}.${random}`;
    
    try {
      // Serialize data with pretty printing for debuggability
      const jsonContent = JSON.stringify(data, null, 2);
      
      // Write to temporary file
      await fs.writeFile(tmpPath, jsonContent, { 
        encoding: 'utf8',
        flag: 'w' 
      });
      
      // Force flush to disk (important for Pi reliability)
      try {
        const fd = await fs.open(tmpPath, 'r+');
        await fd.sync();
        await fd.close();
      } catch (syncError) {
        // Sync might not be supported on all filesystems, continue anyway
        console.warn('Could not sync file to disk:', syncError.message);
      }
      
      // Atomic rename (this is the atomic operation)
      await fs.rename(tmpPath, filepath);
      
    } catch (error) {
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tmpPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      throw new Error(`Atomic write failed: ${error.message}`);
    }
  }

  /**
   * Validate snapshot structure
   * @param {Object} snapshot - Snapshot to validate
   * @returns {boolean} - True if valid
   */
  validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = ['time', 'total_value_usd', 'positions'];
    for (const field of requiredFields) {
      if (!(field in snapshot)) {
        console.error(`Missing required field in snapshot: ${field}`);
        return false;
      }
    }

    // Validate types
    if (typeof snapshot.time !== 'number' || snapshot.time <= 0) {
      console.error('Invalid timestamp in snapshot');
      return false;
    }

    if (typeof snapshot.total_value_usd !== 'number' || snapshot.total_value_usd < 0) {
      console.error('Invalid total value in snapshot');
      return false;
    }

    if (!Array.isArray(snapshot.positions)) {
      console.error('Invalid positions array in snapshot');
      return false;
    }

    // Validate each position
    for (let i = 0; i < snapshot.positions.length; i++) {
      const position = snapshot.positions[i];
      if (!this.validatePosition(position)) {
        console.error(`Invalid position at index ${i}:`, position);
        return false;
      }
    }

    return true;
  }

  /**
   * Validate position structure
   * @param {Object} position - Position to validate
   * @returns {boolean} - True if valid
   */
  validatePosition(position) {
    if (!position || typeof position !== 'object') {
      return false;
    }

    // Required fields for position
    const requiredFields = ['symbol', 'free', 'price', 'value'];
    for (const field of requiredFields) {
      if (!(field in position)) {
        return false;
      }
    }

    // Type validation
    if (typeof position.symbol !== 'string' || position.symbol.length === 0) {
      return false;
    }

    const numericFields = ['free', 'price', 'value'];
    for (const field of numericFields) {
      if (typeof position[field] !== 'number' || position[field] < 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Clean up old temporary files (maintenance operation)
   * @returns {Promise<void>}
   */
  async cleanupTempFiles() {
    try {
      const files = await fs.readdir(this.dataDir);
      const tempFiles = files.filter(file => file.includes('.tmp.'));
      
      for (const tempFile of tempFiles) {
        const tempPath = path.join(this.dataDir, tempFile);
        try {
          const stats = await fs.stat(tempPath);
          const age = Date.now() - stats.mtime.getTime();
          
          // Remove temp files older than 1 hour
          if (age > 3600000) {
            await fs.unlink(tempPath);
            console.log(`Cleaned up old temp file: ${tempFile}`);
          }
        } catch (error) {
          // File might have been removed already, ignore
        }
      }
    } catch (error) {
      console.warn('Error cleaning up temp files:', error.message);
    }
  }

  /**
   * Get file system information
   * @returns {Promise<Object>} - File system stats
   */
  async getFileSystemStats() {
    try {
      const stats = await fs.stat(this.statePath);
      return {
        exists: true,
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime
      };
    } catch (error) {
      return {
        exists: false,
        size: 0,
        modified: null,
        created: null,
        error: error.message
      };
    }
  }

  /**
   * Backup current state to a timestamped file
   * @returns {Promise<string>} - Backup file path
   */
  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.dataDir, `state-backup-${timestamp}.json`);
    
    try {
      await fs.copyFile(this.statePath, backupPath);
      console.log(`State backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      throw new Error(`Backup failed: ${error.message}`);
    }
  }
}

module.exports = StateManager;