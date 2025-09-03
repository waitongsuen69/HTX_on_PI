/**
 * Portfolio Calculator
 * Handles portfolio valuation and P/L calculations with LOFO integration
 */
class Calculator {
  constructor(lotsManager = null) {
    this.lotsManager = lotsManager;
  }

  /**
   * Compute complete portfolio snapshot
   * @param {Object} balances - Balance data from exchange
   * @param {Object} prices - Price data from exchange
   * @param {Object} lotsData - LOFO lots data
   * @returns {Object} - Complete portfolio snapshot
   */
  computeSnapshot(balances, prices, lotsData) {
    if (!balances || typeof balances !== 'object') {
      throw new Error('Balances data is required');
    }

    if (!prices || typeof prices !== 'object') {
      throw new Error('Prices data is required');
    }

    if (!lotsData || typeof lotsData !== 'object') {
      console.warn('No lots data provided, P/L calculations will be unavailable');
      lotsData = { meta: { last_id: 0 } };
    }

    const positions = [];
    let totalValue = 0;
    let weightedChange = 0;

    // Process each balance
    for (const [symbol, balance] of Object.entries(balances)) {
      const position = this.calculatePosition(symbol, balance, prices[symbol], lotsData);
      
      if (position.value > 0) { // Only include positions with value
        positions.push(position);
        totalValue += position.value;
        
        // Calculate weighted contribution to total change
        if (position.day_pct !== null && typeof position.day_pct === 'number') {
          weightedChange += position.value * position.day_pct;
        }
      }
    }

    // Calculate total weighted 24h change percentage
    const totalChange24h = totalValue > 0 ? (weightedChange / totalValue) : 0;

    // Sort positions by value (descending) for consistent display
    positions.sort((a, b) => b.value - a.value);

    return {
      time: Math.floor(Date.now() / 1000),
      ref_fiat: process.env.REF_FIAT || 'USD',
      total_value_usd: parseFloat(totalValue.toFixed(2)),
      total_change_24h_pct: parseFloat(totalChange24h.toFixed(2)),
      positions: positions
    };
  }

  /**
   * Calculate individual position with P/L
   * @param {string} symbol - Asset symbol
   * @param {Object} balance - Balance object with free/locked
   * @param {Object} priceData - Price data with last/change24h
   * @param {Object} lotsData - LOFO lots data
   * @returns {Object} - Position object
   */
  calculatePosition(symbol, balance, priceData, lotsData) {
    // Default values
    const free = balance?.free || 0;
    const price = priceData?.last || 0;
    const dayChange = priceData?.change24h || 0;
    
    // Calculate basic values
    const value = free * price;
    
    // Get average cost from lots
    const avgCost = this.getAverageCost(symbol, lotsData);
    
    // Calculate P/L percentage
    let pnlPct = null;
    if (avgCost && avgCost > 0 && price > 0) {
      pnlPct = ((price / avgCost - 1) * 100);
      pnlPct = parseFloat(pnlPct.toFixed(2));
    }

    // Check reconciliation
    const unreconciled = this.checkReconciliation(free, lotsData[symbol]);

    return {
      symbol,
      free: parseFloat(free.toFixed(8)),
      price: parseFloat(price.toFixed(2)),
      value: parseFloat(value.toFixed(2)),
      day_pct: parseFloat(dayChange.toFixed(2)),
      pnl_pct: pnlPct,
      avg_cost: avgCost ? parseFloat(avgCost.toFixed(2)) : null,
      unreconciled
    };
  }

  /**
   * Get average cost for a symbol from lots data
   * @param {string} symbol - Asset symbol
   * @param {Object} lotsData - LOFO lots data
   * @returns {number|null} - Average cost or null
   */
  getAverageCost(symbol, lotsData) {
    if (!lotsData || !lotsData[symbol] || !Array.isArray(lotsData[symbol].lots)) {
      return null;
    }

    const lots = lotsData[symbol].lots;
    
    // Filter for positive quantities with valid unit costs
    const validLots = lots.filter(lot => 
      lot.qty > 0 && 
      lot.unit_cost !== null && 
      typeof lot.unit_cost === 'number' &&
      lot.unit_cost > 0
    );

    if (validLots.length === 0) {
      return null;
    }

    // Calculate weighted average
    const totalQty = validLots.reduce((sum, lot) => sum + lot.qty, 0);
    const totalCost = validLots.reduce((sum, lot) => sum + (lot.qty * lot.unit_cost), 0);

    return totalQty > 0 ? (totalCost / totalQty) : null;
  }

  /**
   * Check if position is reconciled with lots data
   * @param {number} actualBalance - Actual balance from exchange
   * @param {Object} symbolLots - Lots data for the symbol
   * @returns {boolean} - True if unreconciled (mismatch exists)
   */
  checkReconciliation(actualBalance, symbolLots) {
    if (!symbolLots || !Array.isArray(symbolLots.lots)) {
      // No lots data - unreconciled if there's actual balance
      return actualBalance > 1e-8;
    }

    // Calculate total quantity from positive lots
    const lotsBalance = symbolLots.lots
      .filter(lot => lot.qty > 0)
      .reduce((sum, lot) => sum + lot.qty, 0);

    // Check if difference is significant (accounting for floating point precision)
    const difference = Math.abs(actualBalance - lotsBalance);
    return difference > 1e-8;
  }

  /**
   * Calculate portfolio statistics
   * @param {Array} positions - Array of position objects
   * @returns {Object} - Portfolio statistics
   */
  calculatePortfolioStats(positions) {
    if (!Array.isArray(positions) || positions.length === 0) {
      return {
        totalPositions: 0,
        reconciled: 0,
        unreconciled: 0,
        withPnL: 0,
        withoutPnL: 0,
        avgPnL: null,
        bestPerformer: null,
        worstPerformer: null
      };
    }

    const stats = {
      totalPositions: positions.length,
      reconciled: positions.filter(p => !p.unreconciled).length,
      unreconciled: positions.filter(p => p.unreconciled).length,
      withPnL: positions.filter(p => p.pnl_pct !== null).length,
      withoutPnL: positions.filter(p => p.pnl_pct === null).length
    };

    // Calculate average P/L (weighted by value)
    const positionsWithPnL = positions.filter(p => p.pnl_pct !== null && p.value > 0);
    if (positionsWithPnL.length > 0) {
      const totalValue = positionsWithPnL.reduce((sum, p) => sum + p.value, 0);
      const weightedPnL = positionsWithPnL.reduce((sum, p) => sum + (p.value * p.pnl_pct), 0);
      stats.avgPnL = totalValue > 0 ? parseFloat((weightedPnL / totalValue).toFixed(2)) : null;

      // Find best and worst performers
      const sortedByPnL = [...positionsWithPnL].sort((a, b) => b.pnl_pct - a.pnl_pct);
      stats.bestPerformer = sortedByPnL[0];
      stats.worstPerformer = sortedByPnL[sortedByPnL.length - 1];
    } else {
      stats.avgPnL = null;
      stats.bestPerformer = null;
      stats.worstPerformer = null;
    }

    return stats;
  }

  /**
   * Calculate historical performance metrics
   * @param {Array} snapshots - Array of historical snapshots
   * @returns {Object} - Performance metrics
   */
  calculateHistoricalMetrics(snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length < 2) {
      return {
        periodReturn: null,
        volatility: null,
        maxValue: null,
        minValue: null,
        avgValue: null,
        dataPoints: snapshots.length
      };
    }

    // Sort by time (oldest first for calculations)
    const sortedSnapshots = [...snapshots].sort((a, b) => a.time - b.time);
    
    const values = sortedSnapshots.map(s => s.total_value_usd);
    const startValue = values[0];
    const endValue = values[values.length - 1];
    
    // Calculate period return
    const periodReturn = startValue > 0 ? ((endValue / startValue - 1) * 100) : null;
    
    // Calculate daily returns for volatility
    const dailyReturns = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > 0) {
        dailyReturns.push((values[i] / values[i - 1] - 1) * 100);
      }
    }
    
    // Calculate volatility (standard deviation of returns)
    let volatility = null;
    if (dailyReturns.length > 1) {
      const avgReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
      volatility = Math.sqrt(variance);
    }

    return {
      periodReturn: periodReturn ? parseFloat(periodReturn.toFixed(2)) : null,
      volatility: volatility ? parseFloat(volatility.toFixed(2)) : null,
      maxValue: parseFloat(Math.max(...values).toFixed(2)),
      minValue: parseFloat(Math.min(...values).toFixed(2)),
      avgValue: parseFloat((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)),
      dataPoints: snapshots.length
    };
  }

  /**
   * Format currency value for display
   * @param {number} value - Numeric value
   * @param {string} currency - Currency code
   * @param {number} decimals - Number of decimal places
   * @returns {string} - Formatted string
   */
  formatCurrency(value, currency = 'USD', decimals = 2) {
    if (typeof value !== 'number' || isNaN(value)) {
      return `0.00 ${currency}`;
    }

    return `${value.toFixed(decimals)} ${currency}`;
  }

  /**
   * Format percentage for display
   * @param {number} percentage - Percentage value
   * @param {number} decimals - Number of decimal places
   * @returns {string} - Formatted percentage string
   */
  formatPercentage(percentage, decimals = 2) {
    if (typeof percentage !== 'number' || isNaN(percentage)) {
      return 'N/A';
    }

    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${percentage.toFixed(decimals)}%`;
  }

  /**
   * Validate snapshot data structure
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
        return false;
      }
    }

    // Type validations
    if (typeof snapshot.time !== 'number' || snapshot.time <= 0) {
      return false;
    }

    if (typeof snapshot.total_value_usd !== 'number' || snapshot.total_value_usd < 0) {
      return false;
    }

    if (!Array.isArray(snapshot.positions)) {
      return false;
    }

    // Validate each position
    for (const position of snapshot.positions) {
      if (!this.validatePosition(position)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate position data structure
   * @param {Object} position - Position to validate
   * @returns {boolean} - True if valid
   */
  validatePosition(position) {
    if (!position || typeof position !== 'object') {
      return false;
    }

    // Required fields
    const requiredFields = ['symbol', 'free', 'price', 'value'];
    for (const field of requiredFields) {
      if (!(field in position)) {
        return false;
      }
    }

    // Type validations
    if (typeof position.symbol !== 'string' || position.symbol.length === 0) {
      return false;
    }

    const numericFields = ['free', 'price', 'value'];
    for (const field of numericFields) {
      if (typeof position[field] !== 'number' || position[field] < 0) {
        return false;
      }
    }

    // Optional fields validation
    if (position.pnl_pct !== null && typeof position.pnl_pct !== 'number') {
      return false;
    }

    if (position.avg_cost !== null && typeof position.avg_cost !== 'number') {
      return false;
    }

    if (typeof position.unreconciled !== 'boolean') {
      return false;
    }

    return true;
  }
}

module.exports = Calculator;