const fs = require('fs').promises;
const path = require('path');

/**
 * LOFO (Lowest-First-Out) Accounting Engine
 * Manages cost basis lots with sequential ID generation and atomic writes
 */
class LotsManager {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.lotsPath = path.join(dataDir, 'cost_basis_lots.json');
    
    // Ensure data directory exists
    this.ensureDataDir();
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
   * Load lots from disk
   * @returns {Promise<Object>} - Lots data structure
   */
  async loadLots() {
    try {
      const data = await fs.readFile(this.lotsPath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Validate structure
      if (parsed && parsed.meta && typeof parsed.meta.last_id === 'number') {
        return parsed;
      } else {
        console.warn('Invalid lots file format, starting fresh');
        return this.createEmptyLotsData();
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No existing lots file, starting fresh');
        return this.createEmptyLotsData();
      } else {
        console.error('Error loading lots:', error.message);
        return this.createEmptyLotsData();
      }
    }
  }

  /**
   * Create empty lots data structure
   * @returns {Object} - Empty lots data
   */
  createEmptyLotsData() {
    return {
      meta: { last_id: 0 }
    };
  }

  /**
   * Save lots data atomically
   * @param {Object} lotsData - Complete lots data structure
   * @returns {Promise<void>}
   */
  async saveLotsAtomic(lotsData) {
    // Validate structure
    if (!this.validateLotsData(lotsData)) {
      throw new Error('Invalid lots data structure');
    }

    await this.atomicWrite(this.lotsPath, lotsData);
    console.log(`Saved lots data: ${Object.keys(lotsData).length - 1} symbols`);
  }

  /**
   * Generate next sequential ID
   * @param {Object} meta - Meta object with last_id
   * @returns {string} - Padded sequential ID (e.g., "000001")
   */
  nextId(meta) {
    if (!meta) {
      throw new Error('Meta object is required for ID generation');
    }
    
    meta.last_id = (meta.last_id || 0) + 1;
    return String(meta.last_id).padStart(6, '0');
  }

  /**
   * Apply an accounting entry (buy, sell, deposit, withdraw)
   * @param {Object} lotsData - Lots data structure (modified in place)
   * @param {string} symbol - Asset symbol (e.g., "BTC")
   * @param {Object} entry - Entry details
   * @param {string} entry.action - Action type: "buy", "sell", "deposit", "withdraw"
   * @param {number} entry.qty - Quantity
   * @param {number} entry.unit_cost - Unit cost (null for deposits/withdrawals)
   * @param {string} entry.ts - ISO timestamp
   * @returns {void}
   */
  applyEntry(lotsData, symbol, entry) {
    // Validate inputs
    if (!lotsData || !lotsData.meta) {
      throw new Error('Invalid lots data structure');
    }

    if (!symbol || typeof symbol !== 'string') {
      throw new Error('Symbol is required and must be a string');
    }

    // Check for specific invalid action first to give more specific error
    if (entry && entry.action && !['buy', 'sell', 'deposit', 'withdraw'].includes(entry.action)) {
      throw new Error(`Unknown action: ${entry.action}`);
    }

    if (!this.validateEntry(entry)) {
      throw new Error('Invalid entry structure');
    }

    // Initialize symbol if it doesn't exist
    if (!lotsData[symbol]) {
      lotsData[symbol] = { lots: [] };
    }

    const { action, qty, unit_cost, ts } = entry;
    const id = this.nextId(lotsData.meta);

    switch (action) {
      case 'buy':
      case 'deposit':
        // Add new lot
        lotsData[symbol].lots.push({
          id,
          action,
          qty,
          unit_cost,
          ts
        });
        break;

      case 'sell':
      case 'withdraw':
        // Apply LOFO deduction first
        lotsData[symbol].lots = this.deductLOFO(lotsData[symbol].lots, qty);
        
        // Add record of the deduction
        lotsData[symbol].lots.push({
          id,
          action,
          qty: -qty, // Negative to indicate outgoing
          unit_cost: null, // Not applicable for outgoing
          ts
        });
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    console.log(`Applied ${action} of ${qty} ${symbol} (ID: ${id})`);
  }

  /**
   * LOFO deduction algorithm - deducts from lowest cost lots first
   * @param {Array} lots - Array of lots for a symbol
   * @param {number} qtyToDeduct - Quantity to deduct
   * @returns {Array} - Updated lots array with deductions applied
   */
  deductLOFO(lots, qtyToDeduct) {
    if (!Array.isArray(lots)) {
      throw new Error('Lots must be an array');
    }

    if (typeof qtyToDeduct !== 'number' || qtyToDeduct <= 0) {
      throw new Error('Quantity to deduct must be a positive number');
    }

    // Create working copy to avoid mutating input
    const workingLots = lots.map(lot => ({ ...lot }));
    
    // Filter only positive quantity lots (exclude withdrawal records)
    const positiveLots = workingLots.filter(lot => lot.qty > 0);
    
    // Sort by unit_cost ascending (null treated as Infinity - highest cost)
    positiveLots.sort((a, b) => {
      const costA = a.unit_cost !== null ? a.unit_cost : Infinity;
      const costB = b.unit_cost !== null ? b.unit_cost : Infinity;
      return costA - costB;
    });

    let remaining = qtyToDeduct;
    const result = [];

    // Apply LOFO deduction
    for (const lot of positiveLots) {
      if (remaining <= 0) {
        // No more to deduct, keep remaining lots as-is
        result.push(lot);
        continue;
      }

      if (lot.qty <= remaining) {
        // Fully consume this lot
        remaining -= lot.qty;
        // Don't add to result (lot is fully consumed)
      } else {
        // Partially consume this lot
        result.push({
          ...lot,
          qty: lot.qty - remaining
        });
        remaining = 0;
      }
    }

    // Add back all negative lots (withdrawal records) unchanged
    const negativeLots = workingLots.filter(lot => lot.qty <= 0);
    result.push(...negativeLots);

    // Filter out lots with negligible quantities to avoid floating point issues
    // Also round quantities to avoid floating point precision issues
    return result.filter(lot => Math.abs(lot.qty) > 1e-12).map(lot => ({
      ...lot,
      qty: Math.round(lot.qty * 1e8) / 1e8 // Round to 8 decimal places
    }));
  }

  /**
   * Calculate average cost for a symbol
   * @param {string} symbol - Asset symbol
   * @param {Object} lotsData - Lots data structure
   * @returns {number|null} - Average cost or null if no valid lots
   */
  avgCost(symbol, lotsData) {
    if (!lotsData[symbol] || !Array.isArray(lotsData[symbol].lots)) {
      return null;
    }

    const lots = lotsData[symbol].lots;
    const validLots = lots.filter(lot => 
      lot.qty > 0 && 
      lot.unit_cost !== null && 
      typeof lot.unit_cost === 'number'
    );

    if (validLots.length === 0) {
      return null;
    }

    const totalQty = validLots.reduce((sum, lot) => sum + lot.qty, 0);
    const totalCost = validLots.reduce((sum, lot) => sum + (lot.qty * lot.unit_cost), 0);

    return totalQty > 0 ? (totalCost / totalQty) : null;
  }

  /**
   * Check reconciliation between actual balance and lots
   * @param {number} actualQty - Actual balance from exchange
   * @param {Object} symbolLots - Lots data for specific symbol
   * @returns {boolean} - True if unreconciled (mismatch exists)
   */
  checkReconciliation(actualQty, symbolLots) {
    if (!symbolLots || !Array.isArray(symbolLots.lots)) {
      // No lots data means unreconciled if there's actual balance
      return actualQty > 1e-8; // Use small epsilon for floating point comparison
    }

    // Calculate total quantity from lots (net position including negatives)
    const lotsQty = symbolLots.lots
      .reduce((sum, lot) => sum + lot.qty, 0);

    // Check if difference is significant (more than 1e-8)
    const difference = Math.abs(actualQty - lotsQty);
    return difference > 1e-8;
  }

  /**
   * Get summary for a symbol
   * @param {string} symbol - Asset symbol
   * @param {Object} lotsData - Lots data structure
   * @returns {Object} - Summary information
   */
  getSymbolSummary(symbol, lotsData) {
    if (!lotsData[symbol]) {
      return {
        totalQty: 0,
        avgCost: null,
        totalCost: 0,
        lotsCount: 0
      };
    }

    const lots = lotsData[symbol].lots;
    const positiveLots = lots.filter(lot => lot.qty > 0);
    const validCostLots = positiveLots.filter(lot => lot.unit_cost !== null);

    const totalQty = positiveLots.reduce((sum, lot) => sum + lot.qty, 0);
    const totalCost = validCostLots.reduce((sum, lot) => sum + (lot.qty * lot.unit_cost), 0);
    const avgCost = this.avgCost(symbol, lotsData);

    return {
      totalQty,
      avgCost,
      totalCost,
      lotsCount: positiveLots.length,
      hasUnknownCosts: positiveLots.length > validCostLots.length
    };
  }

  /**
   * Validate entry structure
   * @param {Object} entry - Entry to validate
   * @returns {boolean} - True if valid
   */
  validateEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = ['action', 'qty', 'ts'];
    for (const field of requiredFields) {
      if (!(field in entry)) {
        console.error(`Missing required field in entry: ${field}`);
        return false;
      }
    }

    // Validate action
    const validActions = ['buy', 'sell', 'deposit', 'withdraw'];
    if (!validActions.includes(entry.action)) {
      console.error(`Invalid action: ${entry.action}`);
      return false;
    }

    // Validate quantity
    if (typeof entry.qty !== 'number' || entry.qty <= 0) {
      console.error('Invalid quantity in entry');
      return false;
    }

    // Validate timestamp
    if (typeof entry.ts !== 'string' || entry.ts.length === 0) {
      console.error('Invalid timestamp in entry');
      return false;
    }

    // unit_cost is optional but if present must be number or null
    if ('unit_cost' in entry && entry.unit_cost !== null && typeof entry.unit_cost !== 'number') {
      console.error('Invalid unit_cost in entry');
      return false;
    }

    return true;
  }

  /**
   * Validate lots data structure
   * @param {Object} lotsData - Lots data to validate
   * @returns {boolean} - True if valid
   */
  validateLotsData(lotsData) {
    if (!lotsData || typeof lotsData !== 'object') {
      return false;
    }

    // Must have meta with last_id
    if (!lotsData.meta || typeof lotsData.meta.last_id !== 'number') {
      console.error('Invalid or missing meta.last_id');
      return false;
    }

    // Validate each symbol's lots
    for (const [symbol, symbolData] of Object.entries(lotsData)) {
      if (symbol === 'meta') continue;

      if (!symbolData || !Array.isArray(symbolData.lots)) {
        console.error(`Invalid lots array for symbol: ${symbol}`);
        return false;
      }

      // Validate each lot
      for (const lot of symbolData.lots) {
        if (!this.validateLot(lot)) {
          console.error(`Invalid lot for symbol ${symbol}:`, lot);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Validate individual lot structure
   * @param {Object} lot - Lot to validate
   * @returns {boolean} - True if valid
   */
  validateLot(lot) {
    if (!lot || typeof lot !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = ['id', 'action', 'qty', 'ts'];
    for (const field of requiredFields) {
      if (!(field in lot)) {
        return false;
      }
    }

    // Type validations
    if (typeof lot.id !== 'string' || lot.id.length === 0) {
      return false;
    }

    const validActions = ['buy', 'sell', 'deposit', 'withdraw'];
    if (!validActions.includes(lot.action)) {
      return false;
    }

    if (typeof lot.qty !== 'number') {
      return false;
    }

    if (typeof lot.ts !== 'string' || lot.ts.length === 0) {
      return false;
    }

    // unit_cost is optional but if present must be number or null
    if ('unit_cost' in lot && lot.unit_cost !== null && typeof lot.unit_cost !== 'number') {
      return false;
    }

    return true;
  }

  /**
   * Atomic write operation using temp file + rename pattern
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
      // Serialize data with pretty printing
      const jsonContent = JSON.stringify(data, null, 2);
      
      // Write to temporary file
      await fs.writeFile(tmpPath, jsonContent, { 
        encoding: 'utf8',
        flag: 'w' 
      });
      
      // Force flush to disk
      try {
        const fd = await fs.open(tmpPath, 'r+');
        await fd.sync();
        await fd.close();
      } catch (syncError) {
        // Sync might not be supported, continue anyway
        console.warn('Could not sync lots file to disk:', syncError.message);
      }
      
      // Atomic rename
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
}

module.exports = LotsManager;