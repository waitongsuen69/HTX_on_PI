/**
 * LOFO (Lowest-First-Out) Algorithm Unit Tests
 * Tests the critical cost basis accounting engine
 */

const path = require('path');
const fs = require('fs').promises;
const LotsManager = require('../../src/lots');

describe('LotsManager', () => {
  let lotsManager;
  let tempDir;

  beforeEach(async () => {
    tempDir = await global.testUtils.createTempDir();
    lotsManager = new LotsManager(tempDir);
  });

  afterEach(async () => {
    await global.testUtils.cleanupTempDir(tempDir);
  });

  describe('Constructor and Initialization', () => {
    test('should create instance with default data directory', () => {
      const lots = new LotsManager();
      expect(lots.dataDir).toBe('./data');
    });

    test('should create instance with custom data directory', () => {
      expect(lotsManager.dataDir).toBe(tempDir);
      expect(lotsManager.lotsPath).toBe(path.join(tempDir, 'cost_basis_lots.json'));
    });

    test('should ensure data directory exists', async () => {
      const newDir = path.join(tempDir, 'nested', 'deep');
      const lots = new LotsManager(newDir);
      await lots.ensureDataDir();
      
      const exists = await global.testUtils.pathExists(newDir);
      expect(exists).toBe(true);
    });
  });

  describe('Empty Lots Data Creation', () => {
    test('should create valid empty lots data structure', () => {
      const emptyData = lotsManager.createEmptyLotsData();
      
      expect(emptyData).toEqual({
        meta: { last_id: 0 }
      });
    });
  });

  describe('Load and Save Operations', () => {
    test('should create empty data when no file exists', async () => {
      const data = await lotsManager.loadLots();
      
      expect(data).toEqual({
        meta: { last_id: 0 }
      });
    });

    test('should save and load lots data atomically', async () => {
      const testData = {
        meta: { last_id: 2 },
        BTC: {
          lots: [
            { id: '000001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01T12:00:00Z' },
            { id: '000002', action: 'sell', qty: -0.2, unit_cost: null, ts: '2024-01-02T12:00:00Z' }
          ]
        }
      };

      await lotsManager.saveLotsAtomic(testData);
      const loadedData = await lotsManager.loadLots();
      
      expect(loadedData).toEqual(testData);
    });

    test('should handle corrupted lots file gracefully', async () => {
      // Write invalid JSON
      const lotsPath = path.join(tempDir, 'cost_basis_lots.json');
      await fs.writeFile(lotsPath, '{ invalid json');
      
      const data = await lotsManager.loadLots();
      expect(data).toEqual({ meta: { last_id: 0 } });
    });

    test('should validate lots data before saving', async () => {
      const invalidData = { invalid: 'structure' };
      
      await expect(lotsManager.saveLotsAtomic(invalidData))
        .rejects.toThrow('Invalid lots data structure');
    });
  });

  describe('Sequential ID Generation', () => {
    test('should generate sequential IDs starting from 1', () => {
      const meta = { last_id: 0 };
      
      const id1 = lotsManager.nextId(meta);
      const id2 = lotsManager.nextId(meta);
      const id3 = lotsManager.nextId(meta);
      
      expect(id1).toBe('000001');
      expect(id2).toBe('000002');
      expect(id3).toBe('000003');
      expect(meta.last_id).toBe(3);
    });

    test('should pad IDs with leading zeros', () => {
      const meta = { last_id: 999 };
      
      const id = lotsManager.nextId(meta);
      expect(id).toBe('001000');
      expect(meta.last_id).toBe(1000);
    });

    test('should handle null meta gracefully', () => {
      expect(() => lotsManager.nextId(null))
        .toThrow('Meta object is required for ID generation');
    });

    test('should initialize last_id if undefined', () => {
      const meta = {};
      const id = lotsManager.nextId(meta);
      
      expect(id).toBe('000001');
      expect(meta.last_id).toBe(1);
    });
  });

  describe('Entry Application', () => {
    let lotsData;

    beforeEach(() => {
      lotsData = lotsManager.createEmptyLotsData();
    });

    test('should apply buy entry correctly', () => {
      const entry = {
        action: 'buy',
        qty: 0.5,
        unit_cost: 60000,
        ts: '2024-01-01T12:00:00Z'
      };

      lotsManager.applyEntry(lotsData, 'BTC', entry);
      
      expect(lotsData.meta.last_id).toBe(1);
      expect(lotsData.BTC.lots).toHaveLength(1);
      expect(lotsData.BTC.lots[0]).toEqual({
        id: '000001',
        action: 'buy',
        qty: 0.5,
        unit_cost: 60000,
        ts: '2024-01-01T12:00:00Z'
      });
    });

    test('should apply deposit entry correctly', () => {
      const entry = {
        action: 'deposit',
        qty: 2.0,
        unit_cost: null,
        ts: '2024-01-01T12:00:00Z'
      };

      lotsManager.applyEntry(lotsData, 'ETH', entry);
      
      expect(lotsData.ETH.lots[0]).toMatchObject({
        action: 'deposit',
        qty: 2.0,
        unit_cost: null
      });
    });

    test('should apply sell entry with LOFO deduction', () => {
      // Setup initial lots
      lotsData.meta.last_id = 2;
      lotsData.BTC = {
        lots: [
          { id: '000001', action: 'buy', qty: 0.3, unit_cost: 60000, ts: '2024-01-01T12:00:00Z' },
          { id: '000002', action: 'buy', qty: 0.4, unit_cost: 62000, ts: '2024-01-02T12:00:00Z' }
        ]
      };

      const sellEntry = {
        action: 'sell',
        qty: 0.2,
        unit_cost: 63000, // Ignored for sells
        ts: '2024-01-03T12:00:00Z'
      };

      lotsManager.applyEntry(lotsData, 'BTC', sellEntry);
      
      // Should have deducted from lowest cost lot first
      expect(lotsData.BTC.lots).toHaveLength(3);
      expect(lotsData.BTC.lots[0].qty).toBe(0.1); // Reduced from 0.3 to 0.1
      expect(lotsData.BTC.lots[1].qty).toBe(0.4); // Unchanged
      
      // Should have added sell record
      const sellRecord = lotsData.BTC.lots[2];
      expect(sellRecord.action).toBe('sell');
      expect(sellRecord.qty).toBe(-0.2); // Negative
      expect(sellRecord.unit_cost).toBeNull();
    });

    test('should handle withdraw entry correctly', () => {
      // Setup initial deposit
      lotsData.meta.last_id = 1;
      lotsData.ETH = {
        lots: [
          { id: '000001', action: 'deposit', qty: 5.0, unit_cost: null, ts: '2024-01-01T12:00:00Z' }
        ]
      };

      const withdrawEntry = {
        action: 'withdraw',
        qty: 2.0,
        ts: '2024-01-02T12:00:00Z'
      };

      lotsManager.applyEntry(lotsData, 'ETH', withdrawEntry);
      
      expect(lotsData.ETH.lots[0].qty).toBe(3.0); // Reduced
      expect(lotsData.ETH.lots[1].action).toBe('withdraw');
      expect(lotsData.ETH.lots[1].qty).toBe(-2.0);
    });

    test('should validate entry structure', () => {
      const invalidEntry = { action: 'buy' }; // Missing required fields
      
      expect(() => lotsManager.applyEntry(lotsData, 'BTC', invalidEntry))
        .toThrow('Invalid entry structure');
    });

    test('should reject invalid actions', () => {
      const invalidEntry = {
        action: 'invalid_action',
        qty: 1.0,
        ts: '2024-01-01T12:00:00Z'
      };

      expect(() => lotsManager.applyEntry(lotsData, 'BTC', invalidEntry))
        .toThrow('Unknown action: invalid_action');
    });
  });

  describe('LOFO Deduction Algorithm', () => {
    test('should deduct from lowest cost lots first', () => {
      const lots = [
        { id: '001', action: 'buy', qty: 0.3, unit_cost: 62000, ts: '2024-01-02' },
        { id: '002', action: 'buy', qty: 0.4, unit_cost: 60000, ts: '2024-01-01' },  // Lowest cost
        { id: '003', action: 'buy', qty: 0.2, unit_cost: 64000, ts: '2024-01-03' }
      ];

      const result = lotsManager.deductLOFO(lots, 0.5);
      
      expect(result).toHaveLength(2);
      
      // Lowest cost lot (60000) should be fully consumed
      const remaining60k = result.find(lot => lot.unit_cost === 60000);
      expect(remaining60k).toBeUndefined();
      
      // Next lowest (62000) should be partially consumed: 0.3 - 0.1 = 0.2
      const remaining62k = result.find(lot => lot.unit_cost === 62000);
      expect(remaining62k.qty).toBeCloseTo(0.2);
      
      // Highest cost lot should be unchanged
      const remaining64k = result.find(lot => lot.unit_cost === 64000);
      expect(remaining64k.qty).toBe(0.2);
    });

    test('should treat null unit_cost as highest cost (Infinity)', () => {
      const lots = [
        { id: '001', action: 'deposit', qty: 1.0, unit_cost: null, ts: '2024-01-01' },
        { id: '002', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-02' }
      ];

      const result = lotsManager.deductLOFO(lots, 0.3);
      
      // Should deduct from bought lot first (lower cost than null)
      expect(result).toHaveLength(2);
      
      const boughtLot = result.find(lot => lot.unit_cost === 60000);
      expect(boughtLot.qty).toBeCloseTo(0.2); // 0.5 - 0.3 = 0.2
      
      const depositLot = result.find(lot => lot.unit_cost === null);
      expect(depositLot.qty).toBe(1.0); // Unchanged
    });

    test('should preserve negative lots (withdrawal records)', () => {
      const lots = [
        { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' },
        { id: '002', action: 'sell', qty: -0.1, unit_cost: null, ts: '2024-01-02' },
        { id: '003', action: 'buy', qty: 0.3, unit_cost: 62000, ts: '2024-01-03' }
      ];

      const result = lotsManager.deductLOFO(lots, 0.2);
      
      // Should preserve the sell record
      const sellRecord = result.find(lot => lot.action === 'sell');
      expect(sellRecord.qty).toBe(-0.1);
      expect(result).toContainEqual(sellRecord);
    });

    test('should filter out negligible quantities', () => {
      const lots = [
        { id: '001', action: 'buy', qty: 1e-13, unit_cost: 60000, ts: '2024-01-01' }, // Very small
        { id: '002', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-02' }
      ];

      const result = lotsManager.deductLOFO(lots, 0.1);
      
      // Should filter out the negligible quantity
      expect(result).toHaveLength(1);
      expect(result[0].qty).toBeCloseTo(0.4); // 0.5 - 0.1 = 0.4
    });

    test('should validate input parameters', () => {
      expect(() => lotsManager.deductLOFO('invalid', 0.1))
        .toThrow('Lots must be an array');

      expect(() => lotsManager.deductLOFO([], 0))
        .toThrow('Quantity to deduct must be a positive number');

      expect(() => lotsManager.deductLOFO([], -0.1))
        .toThrow('Quantity to deduct must be a positive number');
    });

    test('should handle edge case of exact quantity match', () => {
      const lots = [
        { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' }
      ];

      const result = lotsManager.deductLOFO(lots, 0.5);
      
      // Should fully consume the lot
      expect(result).toHaveLength(0);
    });
  });

  describe('Average Cost Calculation', () => {
    let lotsData;

    beforeEach(() => {
      lotsData = {
        meta: { last_id: 3 },
        BTC: {
          lots: [
            { id: '001', action: 'buy', qty: 0.3, unit_cost: 60000, ts: '2024-01-01' },
            { id: '002', action: 'buy', qty: 0.2, unit_cost: 62000, ts: '2024-01-02' },
            { id: '003', action: 'deposit', qty: 0.1, unit_cost: null, ts: '2024-01-03' }
          ]
        },
        ETH: {
          lots: [
            { id: '004', action: 'deposit', qty: 2.0, unit_cost: null, ts: '2024-01-01' }
          ]
        }
      };
    });

    test('should calculate weighted average cost correctly', () => {
      const avgCost = lotsManager.avgCost('BTC', lotsData);
      
      // Expected: (0.3 * 60000 + 0.2 * 62000) / (0.3 + 0.2) = 30400 / 0.5 = 60800
      expect(avgCost).toBeCloseTo(60800);
    });

    test('should return null for deposits-only symbol', () => {
      const avgCost = lotsManager.avgCost('ETH', lotsData);
      expect(avgCost).toBeNull();
    });

    test('should return null for non-existent symbol', () => {
      const avgCost = lotsManager.avgCost('NONEXISTENT', lotsData);
      expect(avgCost).toBeNull();
    });

    test('should ignore lots with null unit_cost', () => {
      // Add a buy lot to ETH
      lotsData.ETH.lots.push({
        id: '005', action: 'buy', qty: 1.0, unit_cost: 3500, ts: '2024-01-04'
      });

      const avgCost = lotsManager.avgCost('ETH', lotsData);
      expect(avgCost).toBe(3500); // Only considers the buy lot
    });

    test('should handle negative quantities (ignore them)', () => {
      lotsData.BTC.lots.push({
        id: '006', action: 'sell', qty: -0.1, unit_cost: null, ts: '2024-01-04'
      });

      const avgCost = lotsManager.avgCost('BTC', lotsData);
      expect(avgCost).toBeCloseTo(60800); // Should be unchanged
    });
  });

  describe('Reconciliation Checking', () => {
    test('should detect reconciled balance', () => {
      const symbolLots = {
        lots: [
          { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' },
          { id: '002', action: 'sell', qty: -0.2, unit_cost: null, ts: '2024-01-02' }
        ]
      };

      const isUnreconciled = lotsManager.checkReconciliation(0.3, symbolLots);
      expect(isUnreconciled).toBe(false); // Should be reconciled
    });

    test('should detect unreconciled balance', () => {
      const symbolLots = {
        lots: [
          { id: '001', action: 'buy', qty: 0.5, unit_cost: 60000, ts: '2024-01-01' }
        ]
      };

      const isUnreconciled = lotsManager.checkReconciliation(0.7, symbolLots);
      expect(isUnreconciled).toBe(true); // Should be unreconciled
    });

    test('should handle floating point precision', () => {
      const symbolLots = {
        lots: [
          { id: '001', action: 'buy', qty: 0.1 + 0.2, unit_cost: 60000, ts: '2024-01-01' }
        ]
      };

      // JavaScript: 0.1 + 0.2 = 0.30000000000000004
      const isUnreconciled = lotsManager.checkReconciliation(0.3, symbolLots);
      expect(isUnreconciled).toBe(false); // Should be reconciled due to epsilon tolerance
    });

    test('should handle null lots data', () => {
      const isUnreconciled = lotsManager.checkReconciliation(0.5, null);
      expect(isUnreconciled).toBe(true); // No lots data means unreconciled
    });

    test('should handle zero balance correctly', () => {
      const isUnreconciled = lotsManager.checkReconciliation(0, null);
      expect(isUnreconciled).toBe(false); // Zero balance with no lots is reconciled
    });
  });

  describe('Symbol Summary', () => {
    let lotsData;

    beforeEach(() => {
      lotsData = {
        meta: { last_id: 3 },
        BTC: {
          lots: [
            { id: '001', action: 'buy', qty: 0.3, unit_cost: 60000, ts: '2024-01-01' },
            { id: '002', action: 'buy', qty: 0.2, unit_cost: 62000, ts: '2024-01-02' },
            { id: '003', action: 'deposit', qty: 0.1, unit_cost: null, ts: '2024-01-03' }
          ]
        }
      };
    });

    test('should generate complete summary for symbol', () => {
      const summary = lotsManager.getSymbolSummary('BTC', lotsData);
      
      expect(summary).toEqual({
        totalQty: 0.6, // 0.3 + 0.2 + 0.1
        avgCost: 60800, // Weighted average of buy lots only
        totalCost: 30400, // (0.3 * 60000) + (0.2 * 62000)
        lotsCount: 3, // All positive lots
        hasUnknownCosts: true // Has deposit with null cost
      });
    });

    test('should handle non-existent symbol', () => {
      const summary = lotsManager.getSymbolSummary('NONEXISTENT', lotsData);
      
      expect(summary).toEqual({
        totalQty: 0,
        avgCost: null,
        totalCost: 0,
        lotsCount: 0
      });
    });

    test('should handle symbol with only known costs', () => {
      lotsData.ETH = {
        lots: [
          { id: '004', action: 'buy', qty: 1.0, unit_cost: 3500, ts: '2024-01-01' },
          { id: '005', action: 'buy', qty: 2.0, unit_cost: 3600, ts: '2024-01-02' }
        ]
      };

      const summary = lotsManager.getSymbolSummary('ETH', lotsData);
      
      expect(summary.hasUnknownCosts).toBe(false);
      expect(summary.totalQty).toBe(3.0);
      expect(summary.lotsCount).toBe(2);
    });
  });

  describe('Data Validation', () => {
    test('should validate entry structure correctly', () => {
      const validEntry = {
        action: 'buy',
        qty: 1.0,
        unit_cost: 60000,
        ts: '2024-01-01T12:00:00Z'
      };

      expect(lotsManager.validateEntry(validEntry)).toBe(true);
    });

    test('should reject invalid entry structures', () => {
      const testCases = [
        null,
        {},
        { action: 'buy' }, // Missing fields
        { action: 'invalid', qty: 1.0, ts: '2024-01-01' },
        { action: 'buy', qty: -1.0, ts: '2024-01-01' },
        { action: 'buy', qty: 1.0, ts: '' },
        { action: 'buy', qty: 1.0, ts: '2024-01-01', unit_cost: 'invalid' }
      ];

      testCases.forEach(entry => {
        expect(lotsManager.validateEntry(entry)).toBe(false);
      });
    });

    test('should validate lots data structure correctly', () => {
      const validData = {
        meta: { last_id: 1 },
        BTC: {
          lots: [
            { id: '000001', action: 'buy', qty: 1.0, unit_cost: 60000, ts: '2024-01-01' }
          ]
        }
      };

      expect(lotsManager.validateLotsData(validData)).toBe(true);
    });

    test('should reject invalid lots data structures', () => {
      const testCases = [
        null,
        {},
        { meta: {} }, // Missing last_id
        { meta: { last_id: 'invalid' } },
        { meta: { last_id: 1 }, BTC: 'invalid' },
        { meta: { last_id: 1 }, BTC: { lots: 'not_array' } }
      ];

      testCases.forEach(data => {
        expect(lotsManager.validateLotsData(data)).toBe(false);
      });
    });

    test('should validate individual lot structure', () => {
      const validLot = {
        id: '000001',
        action: 'buy',
        qty: 1.0,
        unit_cost: 60000,
        ts: '2024-01-01T12:00:00Z'
      };

      expect(lotsManager.validateLot(validLot)).toBe(true);
    });

    test('should reject invalid lot structures', () => {
      const testCases = [
        null,
        {},
        { id: '', action: 'buy', qty: 1.0, ts: '2024-01-01' },
        { id: '001', action: 'invalid', qty: 1.0, ts: '2024-01-01' },
        { id: '001', action: 'buy', qty: 'invalid', ts: '2024-01-01' },
        { id: '001', action: 'buy', qty: 1.0, ts: '' },
        { id: '001', action: 'buy', qty: 1.0, ts: '2024-01-01', unit_cost: 'invalid' }
      ];

      testCases.forEach(lot => {
        expect(lotsManager.validateLot(lot)).toBe(false);
      });
    });
  });

  describe('Atomic Write Operations', () => {
    test('should write file atomically', async () => {
      const testData = { test: 'data', timestamp: Date.now() };
      const filePath = path.join(tempDir, 'test-atomic.json');

      await lotsManager.atomicWrite(filePath, testData);
      
      // File should exist and contain correct data
      const exists = await global.testUtils.pathExists(filePath);
      expect(exists).toBe(true);

      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(testData);
    });

    test('should clean up temp file on write failure', async () => {
      // Create invalid file path to force failure
      const invalidPath = path.join(tempDir, 'nonexistent-dir', 'file.json');
      const testData = { test: 'data' };

      await expect(lotsManager.atomicWrite(invalidPath, testData))
        .rejects.toThrow('Atomic write failed');

      // Check no temp files left behind
      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });

    test('should handle write permission errors gracefully', async () => {
      // Skip this test on CI/systems where we can't change permissions
      if (process.platform === 'win32' || process.env.CI) {
        return;
      }

      const readonlyDir = path.join(tempDir, 'readonly-dir');
      const filePath = path.join(readonlyDir, 'readonly.json');
      const testData = { test: 'data' };

      try {
        // Create directory with no write permissions
        await fs.mkdir(readonlyDir, { mode: 0o555 }); // Read+execute only, no write

        await expect(lotsManager.atomicWrite(filePath, testData))
          .rejects.toThrow('Atomic write failed');
      } finally {
        // Restore permissions for cleanup
        try {
          await fs.chmod(readonlyDir, 0o755);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });
  });
});