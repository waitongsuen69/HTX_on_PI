const axios = require('axios');
const crypto = require('crypto');

/**
 * HTX API Client with HMAC-SHA256 signing and retry logic
 */
class HTXClient {
  constructor(accessKey, secretKey, accountId, options = {}) {
    // Validate required credentials
    if (!accessKey || accessKey === 'undefined') {
      throw new Error('HTX API access key is required and cannot be "undefined"');
    }
    if (!secretKey || secretKey === 'undefined') {
      throw new Error('HTX API secret key is required and cannot be "undefined"');
    }
    if (!accountId || accountId === 'undefined') {
      throw new Error('HTX account ID is required and cannot be "undefined"');
    }
    
    // Debug mode flag
    this.debug = process.env.DEBUG === 'true';
    
    if (this.debug) {
      console.log('[HTX DEBUG] Initializing HTX client with:', {
        accessKey: accessKey.substring(0, 8) + '...',
        accountId: accountId,
        hasSecretKey: !!secretKey
      });
    }
    
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.accountId = accountId;
    
    this.baseURL = options.baseURL || process.env.HTX_BASE_URL || 'https://api.huobi.pro';
    this.timeout = options.timeout || parseInt(process.env.REQUEST_TIMEOUT_MS) || 10000;
    this.maxRetries = options.maxRetries || parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3;
    this.baseDelay = options.baseDelay || parseInt(process.env.BACKOFF_BASE_MS) || 1000;
    this.maxDelay = options.maxDelay || parseInt(process.env.BACKOFF_MAX_MS) || 30000;
    
    // Create axios instance
    this.httpClient = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HTX-Pi-Monitor/1.0'
      }
    });
    
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // Rate limiting: 100ms between requests
  }

  /**
   * Get all accounts for the current user
   * @returns {Array} - List of account objects
   */
  async getAllAccounts() {
    const path = '/v1/account/accounts';
    const method = 'GET';
    
    console.log('[DEBUG] Fetching all HTX accounts...');
    
    const response = await this.retryWithBackoff(async () => {
      const params = this.createSignedParams(method, path);
      const url = `${path}?${this.buildQueryString(params)}`;
      return await this.httpClient.get(url);
    });
    
    if (response.data.status !== 'ok') {
      throw new Error(`HTX API error: ${response.data.status}`);
    }
    
    const accounts = response.data.data || [];
    console.log('[DEBUG] Found HTX accounts:', JSON.stringify(accounts, null, 2));
    return accounts;
  }

  /**
   * Get account balances
   * @returns {Object} - Format: { BTC: { free: 0.12, locked: 0 }, ... }
   */
  async getBalances() {
    // First, fetch all accounts to see what we have
    const accounts = await this.getAllAccounts();
    
    // Log account IDs and types
    console.log('[DEBUG] Account summary:');
    accounts.forEach(acc => {
      console.log(`  - Account ID: ${acc.id}, Type: ${acc.type}, State: ${acc.state}, Subtype: ${acc.subtype || 'N/A'}`);
    });
    
    // Aggregate balances from all relevant accounts
    const aggregatedBalances = {};
    const method = 'GET';
    
    // Check balances for spot and deposit-earning accounts only
    const relevantAccounts = accounts.filter(acc => 
      acc.state === 'working' && 
      (acc.type === 'spot' || acc.type === 'deposit-earning')
    );
    
    console.log(`[DEBUG] Checking balances for ${relevantAccounts.length} accounts...`);
    
    for (const account of relevantAccounts) {
      const path = `/v1/account/accounts/${account.id}/balance`;
      
      console.log(`[DEBUG] Fetching balances for ${account.type} account ${account.id}...`);
      
      try {
        const response = await this.retryWithBackoff(async () => {
          const params = this.createSignedParams(method, path);
          const url = `${path}?${this.buildQueryString(params)}`;
          return await this.httpClient.get(url);
        });
        
        if (response.data.status === 'ok') {
          const balanceList = response.data.data?.list || [];
          
          // Log non-zero balances for this account
          const nonZeroBalances = balanceList.filter(item => 
            item.type === 'trade' && parseFloat(item.balance) > 0
          );
          
          if (nonZeroBalances.length > 0) {
            console.log(`[DEBUG] Found ${nonZeroBalances.length} non-zero balances in ${account.type} account ${account.id}:`);
            nonZeroBalances.forEach(item => {
              console.log(`  - ${item.currency.toUpperCase()}: ${item.balance}`);
            });
          }
          
          // Debug: Log ETH items specifically for earning account
          if (account.type === 'deposit-earning') {
            const ethItems = balanceList.filter(item => 
              item.currency && item.currency.toLowerCase() === 'eth'
            );
            if (ethItems.length > 0) {
              console.log('[DEBUG] ETH items in deposit-earning account:', JSON.stringify(ethItems, null, 2));
            }
          }
          
          // Aggregate balances - check 'trade', 'saving', and 'lending' types for earning account
          balanceList.forEach(item => {
            const validTypes = account.type === 'deposit-earning' 
              ? ['trade', 'saving', 'lending', 'frozen'] 
              : ['trade'];
            
            if (validTypes.includes(item.type) && parseFloat(item.balance) > 0) {
              const symbol = item.currency.toUpperCase();
              const balance = parseFloat(item.balance);
              
              console.log(`[DEBUG] Adding ${symbol} from ${account.type} (type: ${item.type}): ${balance}`);
              
              if (aggregatedBalances[symbol]) {
                aggregatedBalances[symbol].free += balance;
              } else {
                aggregatedBalances[symbol] = {
                  free: balance,
                  locked: 0
                };
              }
            }
          });
        }
      } catch (error) {
        console.error(`[DEBUG] Error fetching balance for account ${account.id}:`, error.message);
      }
    }
    
    console.log('[DEBUG] Final aggregated balances:', Object.entries(aggregatedBalances).map(([symbol, data]) => 
      `${symbol}: ${data.free}`
    ).join(', '));
    
    return aggregatedBalances;
  }

  /**
   * Get current prices for symbols
   * @param {Array} symbols - Array of symbols like ['BTC', 'ETH']
   * @returns {Object} - Format: { BTC: { last: 62000, change24h: -1.2 }, ... }
   */
  async getPrices(symbols) {
    // HTX tickers endpoint doesn't require authentication
    const response = await this.retryWithBackoff(async () => {
      return await this.httpClient.get('/market/tickers');
    });

    if (response.data.status !== 'ok') {
      throw new Error(`HTX price API error: ${response.data.status}`);
    }

    const tickers = response.data.data || [];
    const prices = {};

    symbols.forEach(symbol => {
      // HTX uses lowercase pairs like 'btcusdt'
      const pairSymbol = `${symbol.toLowerCase()}usdt`;
      const ticker = tickers.find(t => t.symbol === pairSymbol);
      
      if (ticker) {
        const currentPrice = parseFloat(ticker.close);
        const openPrice = parseFloat(ticker.open);
        const change24h = openPrice > 0 ? ((currentPrice - openPrice) / openPrice * 100) : 0;
        
        prices[symbol] = {
          last: currentPrice,
          change24h: parseFloat(change24h.toFixed(2))
        };
      } else {
        // Fallback for USDT itself
        if (symbol === 'USDT') {
          prices[symbol] = {
            last: 1.0,
            change24h: 0
          };
        }
      }
    });

    return prices;
  }

  /**
   * Create signed parameters for HTX API
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - API path
   * @param {Object} body - Request body (optional)
   * @returns {Object} - Signed parameters
   */
  createSignedParams(method, path, body = {}) {
    const timestamp = new Date().toISOString().slice(0, 19);
    
    const params = {
      AccessKeyId: this.accessKey,
      SignatureMethod: 'HmacSHA256',
      SignatureVersion: '2',
      Timestamp: timestamp,
      ...body
    };

    // Create signature
    const signature = this.sign(params, method, path);
    params.Signature = signature;

    return params;
  }

  /**
   * Generate HMAC-SHA256 signature
   * @param {Object} params - Request parameters
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @returns {string} - Base64 encoded signature
   */
  sign(params, method, path) {
    // Sort parameters alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');

    // Create canonical string
    const hostname = new URL(this.baseURL).hostname;
    const canonicalString = `${method.toUpperCase()}\n${hostname}\n${path}\n${sortedParams}`;

    // Generate HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(canonicalString);
    return hmac.digest('base64');
  }

  /**
   * Build query string from parameters
   * @param {Object} params - Parameters object
   * @returns {string} - URL encoded query string
   */
  buildQueryString(params) {
    return Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
  }

  /**
   * Execute function with exponential backoff retry
   * @param {Function} fn - Function to execute
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise} - Function result
   */
  async retryWithBackoff(fn, maxRetries = this.maxRetries) {
    let lastError;
    let delay = this.baseDelay;

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error;
        
        // Enhanced error logging for debugging
        if (error.response) {
          if (this.debug) {
            console.error(`[HTX DEBUG] HTTP Error ${error.response.status} on attempt ${attempt + 1}/${maxRetries + 1}`);
            console.error(`[HTX DEBUG] Response headers:`, error.response.headers);
            console.error(`[HTX DEBUG] Response data:`, JSON.stringify(error.response.data, null, 2));
          }
          
          // Don't retry on client errors (4xx) except rate limiting
          if (error.response.status >= 400 && error.response.status < 500) {
            if (error.response.status === 429) {
              // Rate limit - do retry with longer delay
              console.warn(`HTX rate limit hit, attempt ${attempt + 1}/${maxRetries + 1}`);
            } else if (error.response.status === 401) {
              // Authentication error - log more details
              if (this.debug) {
                console.error('[HTX DEBUG] Authentication failed - check API credentials');
              }
              throw new Error(`HTX Authentication failed (401): ${JSON.stringify(error.response.data)}`);
            } else if (error.response.status === 403) {
              // Forbidden - might be IP whitelist issue
              if (this.debug) {
                console.error('[HTX DEBUG] Access forbidden - check IP whitelist or permissions');
              }
              throw new Error(`HTX Access forbidden (403): ${JSON.stringify(error.response.data)}`);
            } else {
              // Other client errors - don't retry
              throw new Error(`HTX HTTP ${error.response.status} error: ${JSON.stringify(error.response.data)}`);
            }
          }
        } else if (error.request) {
          // Request was made but no response received
          if (this.debug) {
            console.error(`[HTX DEBUG] No response received on attempt ${attempt + 1}/${maxRetries + 1}`);
            console.error('[HTX DEBUG] Request details:', {
              url: error.config?.url,
              method: error.config?.method,
              timeout: error.config?.timeout
            });
          }
        } else {
          // Error in setting up the request
          if (this.debug) {
            console.error(`[HTX DEBUG] Request setup error on attempt ${attempt + 1}/${maxRetries + 1}:`, error.message);
          }
        }

        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          break;
        }

        console.warn(`HTX API error (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
        
        // Wait before retrying with linear backoff
        await this.sleep(Math.min(delay, this.maxDelay));
        delay += this.baseDelay;
      }
    }

    // Provide more context in final error
    let finalErrorMsg = `HTX API failed after ${maxRetries + 1} attempts`;
    if (lastError.response) {
      finalErrorMsg += ` (Last HTTP ${lastError.response.status}): ${JSON.stringify(lastError.response.data)}`;
    } else if (lastError.message) {
      finalErrorMsg += `: ${lastError.message}`;
    } else {
      finalErrorMsg += `: ${lastError}`;
    }
    
    throw new Error(finalErrorMsg);
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test connection to HTX API
   * @returns {Promise<boolean>} - True if connection successful
   */
  async testConnection() {
    try {
      const response = await this.httpClient.get('/v1/common/timestamp');
      return response.data.status === 'ok';
    } catch (error) {
      console.error('HTX connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Get server timestamp (for debugging)
   * @returns {Promise<number>} - Server timestamp in milliseconds
   */
  async getServerTime() {
    try {
      const response = await this.httpClient.get('/v1/common/timestamp');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get server time:', error.message);
      return Date.now();
    }
  }
}

module.exports = HTXClient;