/**
 * State Manager Unit Tests
 * Tests atomic writes, rolling history management, and cache operations
 */

const path = require('path');
const fs = require('fs').promises;
const StateManager = require('../../src/state');

describe('StateManager', () => {
  let stateManager;
  let tempDir;

  beforeEach(async () => {
    tempDir = await global.testUtils.createTempDir();
    stateManager = new StateManager(tempDir, 5); // Small history for testing
  });

  afterEach(async () => {
    await global.testUtils.cleanupTempDir(tempDir);
  });

  describe('Constructor and Initialization', () => {
    test('should create instance with default settings', () => {
      const manager = new StateManager();
      expect(manager.dataDir).toBe('./data');
      expect(manager.maxHistory).toBe(50);
    });

    test('should create instance with custom settings', () => {
      expect(stateManager.dataDir).toBe(tempDir);
      expect(stateManager.maxHistory).toBe(5);
      expect(stateManager.statePath).toBe(path.join(tempDir, 'state.json'));
    });

    test('should initialize with empty cache', () => {
      expect(stateManager.cache).toEqual({ history: [] });
    });

    test('should parse maxHistory as integer', () => {
      const manager = new StateManager('./data', '25');
      expect(manager.maxHistory).toBe(25);
    });

    test('should default maxHistory for invalid values', () => {
      const manager = new StateManager('./data', 'invalid');
      expect(manager.maxHistory).toBe(50);
    });
  });

  describe('Data Directory Management', () => {
    test('should create data directory if it does not exist', async () => {
      const newDir = path.join(tempDir, 'nested', 'deep');
      const manager = new StateManager(newDir);
      
      await manager.ensureDataDir();
      
      const exists = await global.testUtils.pathExists(newDir);
      expect(exists).toBe(true);
    });

    test('should not fail if directory already exists', async () => {
      await stateManager.ensureDataDir();
      
      // Should not throw on second call
      await expect(stateManager.ensureDataDir()).resolves.not.toThrow();
    });
  });

  describe('State Loading', () => {
    test('should load empty state when no file exists', async () => {
      await stateManager.loadState();
      
      expect(stateManager.cache).toEqual({ history: [] });
    });

    test('should load existing state from disk', async () => {
      const testData = {
        history: [
          { time: 1000, total_value_usd: 100, positions: [] },
          { time: 2000, total_value_usd: 200, positions: [] }
        ]
      };

      // Write test data to disk
      await fs.writeFile(stateManager.statePath, JSON.stringify(testData));
      
      await stateManager.loadState();
      
      expect(stateManager.cache).toEqual(testData);
    });

    test('should handle corrupted state file gracefully', async () => {
      // Write invalid JSON
      await fs.writeFile(stateManager.statePath, '{ invalid json');
      
      await stateManager.loadState();
      
      expect(stateManager.cache).toEqual({ history: [] });
    });

    test('should handle invalid state format gracefully', async () => {
      const invalidData = { not_history: 'invalid' };
      await fs.writeFile(stateManager.statePath, JSON.stringify(invalidData));
      
      await stateManager.loadState();
      
      expect(stateManager.cache).toEqual({ history: [] });
    });

    test('should handle file system errors gracefully', async () => {
      // Create a state manager with invalid path to force error (use a path that definitely doesn't exist)
      const invalidPath = '/nonexistent/deeply/nested/path/that/does/not/exist';
      const invalidManager = new StateManager(invalidPath);
      
      await invalidManager.loadState();
      
      expect(invalidManager.cache).toEqual({ history: [] });
    });
  });

  describe('Snapshot Saving', () => {
    test('should save snapshot to cache and disk', async () => {
      const snapshot = global.testUtils.createMockSnapshot();
      
      await stateManager.saveSnapshot(snapshot);
      
      // Check cache
      expect(stateManager.cache.history).toHaveLength(1);
      expect(stateManager.cache.history[0]).toEqual(snapshot);
      
      // Check disk
      const diskData = await fs.readFile(stateManager.statePath, 'utf8');
      const parsed = JSON.parse(diskData);
      expect(parsed.history[0]).toEqual(snapshot);
    });

    test('should maintain rolling history limit', async () => {
      const snapshots = [];
      
      // Add more snapshots than the limit (5)
      for (let i = 0; i < 7; i++) {
        const snapshot = {
          time: 1000 + i,
          total_value_usd: 100 * (i + 1),
          positions: []
        };
        snapshots.push(snapshot);
        await stateManager.saveSnapshot(snapshot);
      }
      
      // Should only keep the latest 5
      expect(stateManager.cache.history).toHaveLength(5);
      
      // Should be in reverse chronological order (newest first)
      expect(stateManager.cache.history[0].time).toBe(1006); // Most recent
      expect(stateManager.cache.history[4].time).toBe(1002); // Oldest kept
    });

    test('should store snapshots in newest-first order', async () => {
      const snapshot1 = { time: 1000, total_value_usd: 100, positions: [] };
      const snapshot2 = { time: 2000, total_value_usd: 200, positions: [] };
      const snapshot3 = { time: 1500, total_value_usd: 150, positions: [] };
      
      await stateManager.saveSnapshot(snapshot1);
      await stateManager.saveSnapshot(snapshot2);
      await stateManager.saveSnapshot(snapshot3);
      
      // Should be ordered by insertion, not timestamp
      expect(stateManager.cache.history[0]).toEqual(snapshot3); // Most recent insert
      expect(stateManager.cache.history[1]).toEqual(snapshot2);
      expect(stateManager.cache.history[2]).toEqual(snapshot1);
    });

    test('should validate snapshot before saving', async () => {
      const invalidSnapshot = { invalid: 'data' };
      
      await expect(stateManager.saveSnapshot(invalidSnapshot))
        .rejects.toThrow('Invalid snapshot format');
    });

    test('should handle atomic write failures gracefully', async () => {
      // Create a read-only directory to force write failure
      if (process.platform !== 'win32' && !process.env.CI) {
        await fs.chmod(tempDir, 0o444);
        
        const snapshot = global.testUtils.createMockSnapshot();
        
        await expect(stateManager.saveSnapshot(snapshot))
          .rejects.toThrow('Atomic write failed');
          
        // Restore permissions
        await fs.chmod(tempDir, 0o755);
      }
    });
  });

  describe('Cache Access Methods', () => {
    beforeEach(async () => {
      // Setup test data
      const snapshots = [
        { time: 3000, total_value_usd: 300, positions: [] },
        { time: 2000, total_value_usd: 200, positions: [] },
        { time: 1000, total_value_usd: 100, positions: [] }
      ];
      
      for (const snapshot of snapshots) {
        await stateManager.saveSnapshot(snapshot);
      }
    });

    test('should get latest snapshot', () => {
      const latest = stateManager.getLatestSnapshot();
      
      expect(latest.time).toBe(1000); // Most recently inserted
      expect(latest.total_value_usd).toBe(100);
    });

    test('should return null when no snapshots exist', () => {
      const emptyManager = new StateManager(tempDir);
      const latest = emptyManager.getLatestSnapshot();
      
      expect(latest).toBeNull();
    });

    test('should get history with default limit', () => {
      const history = stateManager.getHistory();
      
      expect(history).toHaveLength(3);
      expect(history[0].time).toBe(1000); // Newest first
      expect(history[2].time).toBe(3000); // Oldest last
    });

    test('should get history with custom limit', () => {
      const history = stateManager.getHistory(2);
      
      expect(history).toHaveLength(2);
      expect(history[0].time).toBe(1000);
      expect(history[1].time).toBe(2000);
    });

    test('should handle limit larger than available data', () => {
      const history = stateManager.getHistory(10);
      
      expect(history).toHaveLength(3); // All available data
    });

    test('should get cache statistics', () => {
      const stats = stateManager.getCacheStats();
      
      expect(stats.totalSnapshots).toBe(3);
      expect(stats.oldestTime).toBe(3000);
      expect(stats.newestTime).toBe(1000);
      expect(stats.lastSnapshotAt).toBe(1000);
      expect(typeof stats.cacheSize).toBe('number');
      expect(stats.cacheSize).toBeGreaterThan(0);
    });

    test('should handle empty cache in statistics', () => {
      const emptyManager = new StateManager(tempDir);
      const stats = emptyManager.getCacheStats();
      
      expect(stats.totalSnapshots).toBe(0);
      expect(stats.oldestTime).toBeNull();
      expect(stats.newestTime).toBeNull();
      expect(stats.lastSnapshotAt).toBeNull();
    });
  });

  describe('Snapshot Validation', () => {
    test('should validate correct snapshot structure', () => {
      const validSnapshot = {
        time: Math.floor(Date.now() / 1000),
        total_value_usd: 1000.50,
        positions: [
          {
            symbol: 'BTC',
            free: 0.5,
            price: 62000,
            value: 31000
          }
        ]
      };
      
      expect(stateManager.validateSnapshot(validSnapshot)).toBe(true);
    });

    test('should reject invalid snapshot structures', () => {
      const invalidSnapshots = [
        null,
        {},
        { time: 'invalid', total_value_usd: 1000, positions: [] },
        { time: 1000, total_value_usd: -100, positions: [] },
        { time: 1000, total_value_usd: 1000, positions: 'not_array' },
        { time: 0, total_value_usd: 1000, positions: [] }, // Invalid timestamp
        { time: 1000, positions: [] }, // Missing total_value_usd
      ];

      invalidSnapshots.forEach((snapshot, index) => {
        expect(stateManager.validateSnapshot(snapshot)).toBe(false);
      });
    });

    test('should validate position structures within snapshots', () => {
      const snapshotWithInvalidPosition = {
        time: 1000,
        total_value_usd: 1000,
        positions: [
          { symbol: '', free: -1, price: 100, value: 50 } // Invalid position
        ]
      };
      
      expect(stateManager.validateSnapshot(snapshotWithInvalidPosition)).toBe(false);
    });

    test('should validate position structure correctly', () => {
      const validPosition = {
        symbol: 'BTC',
        free: 0.5,
        price: 62000,
        value: 31000
      };
      
      expect(stateManager.validatePosition(validPosition)).toBe(true);
    });

    test('should reject invalid position structures', () => {
      const invalidPositions = [
        null,
        {},
        { symbol: '', free: 0.5, price: 100, value: 50 },
        { symbol: 'BTC', free: -1, price: 100, value: 50 },
        { symbol: 'BTC', free: 0.5, price: -100, value: 50 },
        { symbol: 'BTC', free: 0.5, price: 100, value: -50 },
        { free: 0.5, price: 100, value: 50 }, // Missing symbol
      ];

      invalidPositions.forEach(position => {
        expect(stateManager.validatePosition(position)).toBe(false);
      });
    });
  });

  describe('Atomic Write Operations', () => {
    test('should write data atomically', async () => {
      const testData = { test: 'data', timestamp: Date.now() };
      const filePath = path.join(tempDir, 'test-atomic.json');

      await stateManager.atomicWrite(filePath, testData);
      
      // File should exist and contain correct data
      const exists = await global.testUtils.pathExists(filePath);
      expect(exists).toBe(true);

      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(testData);
    });

    test('should create pretty-printed JSON', async () => {
      const testData = { nested: { data: 'value' }, array: [1, 2, 3] };
      const filePath = path.join(tempDir, 'pretty.json');

      await stateManager.atomicWrite(filePath, testData);
      
      const content = await fs.readFile(filePath, 'utf8');
      
      // Should contain pretty-printing (newlines and indentation)
      expect(content).toContain('\n');
      expect(content).toContain('  '); // Indentation
    });

    test('should clean up temp file on write failure', async () => {
      // Create invalid file path to force failure
      const invalidPath = path.join(tempDir, 'nonexistent-dir', 'file.json');
      const testData = { test: 'data' };

      await expect(stateManager.atomicWrite(invalidPath, testData))
        .rejects.toThrow('Atomic write failed');

      // Check no temp files left behind
      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });

    test('should handle concurrent write attempts', async () => {
      const testData1 = { writer: 1, data: 'first' };
      const testData2 = { writer: 2, data: 'second' };
      const filePath = path.join(tempDir, 'concurrent.json');

      // Start both writes simultaneously
      const promises = [
        stateManager.atomicWrite(filePath, testData1),
        stateManager.atomicWrite(filePath, testData2)
      ];

      await Promise.all(promises);
      
      // One of the writes should have succeeded
      const exists = await global.testUtils.pathExists(filePath);
      expect(exists).toBe(true);

      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      
      // Should be one of the two data sets
      expect(parsed.writer === 1 || parsed.writer === 2).toBe(true);
    });

    test('should generate unique temp file names', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const testData = { test: 'data' };

      // Create multiple managers and write simultaneously
      const manager1 = new StateManager(tempDir);
      const manager2 = new StateManager(tempDir);
      
      // These should both complete successfully due to atomic operations
      const promise1 = manager1.atomicWrite(filePath, { ...testData, source: 'manager1' });
      const promise2 = manager2.atomicWrite(filePath, { ...testData, source: 'manager2' });
      
      await Promise.all([promise1, promise2]);
      
      // File should exist and contain data from one of the managers
      const exists = await global.testUtils.pathExists(filePath);
      expect(exists).toBe(true);
      
      const content = JSON.parse(await fs.readFile(filePath, 'utf8'));
      expect(['manager1', 'manager2']).toContain(content.source);
    });
  });

  describe('Maintenance Operations', () => {
    test('should clean up old temporary files', async () => {
      // Create some temp files with different ages
      const oldTempFile = path.join(tempDir, 'state.json.tmp.1000.abc123');
      const newTempFile = path.join(tempDir, 'state.json.tmp.9999999999999.def456');
      
      await fs.writeFile(oldTempFile, '{}');
      await fs.writeFile(newTempFile, '{}');
      
      // Manually set old timestamp on the old file
      const oldTime = new Date(Date.now() - 7200000); // 2 hours ago
      await fs.utimes(oldTempFile, oldTime, oldTime);

      await stateManager.cleanupTempFiles();
      
      // Old file should be removed, new file should remain
      const oldExists = await global.testUtils.pathExists(oldTempFile);
      const newExists = await global.testUtils.pathExists(newTempFile);
      
      expect(oldExists).toBe(false);
      expect(newExists).toBe(true);
      
      // Cleanup
      await fs.unlink(newTempFile).catch(() => {});
    });

    test('should handle cleanup errors gracefully', async () => {
      // This should not throw even if directory doesn't exist
      const invalidManager = new StateManager('/nonexistent/path');
      await expect(invalidManager.cleanupTempFiles()).resolves.not.toThrow();
    });

    test('should get file system stats', async () => {
      // Create a state file first
      await stateManager.saveSnapshot(global.testUtils.createMockSnapshot());
      
      const stats = await stateManager.getFileSystemStats();
      
      expect(stats.exists).toBe(true);
      expect(typeof stats.size).toBe('number');
      expect(stats.size).toBeGreaterThan(0);
      // Check Date objects by verifying they have getTime method
      expect(typeof stats.modified?.getTime).toBe('function');
      expect(typeof stats.created?.getTime).toBe('function');
      expect(stats.modified?.getTime()).toBeGreaterThan(0);
      expect(stats.created?.getTime()).toBeGreaterThan(0);
    });

    test('should handle non-existent file in stats', async () => {
      const stats = await stateManager.getFileSystemStats();
      
      expect(stats.exists).toBe(false);
      expect(stats.size).toBe(0);
      expect(stats.modified).toBeNull();
      expect(stats.created).toBeNull();
      expect(typeof stats.error).toBe('string');
    });

    test('should create backup of current state', async () => {
      await stateManager.saveSnapshot(global.testUtils.createMockSnapshot());
      
      const backupPath = await stateManager.createBackup();
      
      expect(typeof backupPath).toBe('string');
      expect(backupPath).toContain('state-backup-');
      expect(backupPath).toContain('.json');
      
      const exists = await global.testUtils.pathExists(backupPath);
      expect(exists).toBe(true);
      
      // Backup should contain same data as original
      const originalData = await fs.readFile(stateManager.statePath, 'utf8');
      const backupData = await fs.readFile(backupPath, 'utf8');
      expect(backupData).toBe(originalData);
    });

    test('should handle backup failure gracefully', async () => {
      // Try to backup non-existent file
      await expect(stateManager.createBackup())
        .rejects.toThrow('Backup failed');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle very large history arrays', async () => {
      const largeManager = new StateManager(tempDir, 1000);
      
      // Add many snapshots
      for (let i = 0; i < 100; i++) {
        const snapshot = {
          time: 1000 + i,
          total_value_usd: 100 * (i + 1),
          positions: []
        };
        await largeManager.saveSnapshot(snapshot);
      }
      
      expect(largeManager.cache.history).toHaveLength(100);
      
      const stats = largeManager.getCacheStats();
      expect(stats.totalSnapshots).toBe(100);
      expect(stats.cacheSize).toBeGreaterThan(1000); // Should be substantial
    });

    test('should handle snapshots with empty positions arrays', async () => {
      const emptySnapshot = {
        time: Math.floor(Date.now() / 1000),
        total_value_usd: 0,
        positions: []
      };
      
      await expect(stateManager.saveSnapshot(emptySnapshot))
        .resolves.not.toThrow();
        
      const latest = stateManager.getLatestSnapshot();
      expect(latest.positions).toHaveLength(0);
    });

    test('should handle disk space issues gracefully', async () => {
      // Mock fs.writeFile to simulate disk full error
      const originalWriteFile = fs.writeFile;
      fs.writeFile = jest.fn().mockRejectedValue(new Error('ENOSPC: no space left on device'));
      
      try {
        const snapshot = global.testUtils.createMockSnapshot();
        await expect(stateManager.saveSnapshot(snapshot))
          .rejects.toThrow('Atomic write failed');
      } finally {
        fs.writeFile = originalWriteFile;
      }
    });

    test('should handle corrupted JSON during atomic writes', async () => {
      // Create a test with circular reference to cause JSON.stringify to fail
      const circularData = {};
      circularData.self = circularData;
      
      await expect(stateManager.atomicWrite('/tmp/test.json', circularData))
        .rejects.toThrow();
    });
  });
});