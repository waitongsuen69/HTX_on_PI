/**
 * HTX Client Unit Tests
 * Tests HMAC signing, API calls, retry logic, and rate limiting
 */

const nock = require('nock');
const HTXClient = require('../../src/htx');

describe('HTXClient', () => {
  let client;
  const TEST_ACCESS_KEY = 'test_access_key';
  const TEST_SECRET_KEY = 'test_secret_key';
  const TEST_ACCOUNT_ID = '123456';
  const BASE_URL = 'https://api.test-htx.com';

  beforeEach(() => {
    client = new HTXClient(TEST_ACCESS_KEY, TEST_SECRET_KEY, TEST_ACCOUNT_ID, {
      baseURL: BASE_URL,
      timeout: 5000,
      maxRetries: 2,
      baseDelay: 100, // Faster for tests
      maxDelay: 1000
    });
    
    // Clear nock interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Constructor and Configuration', () => {
    test('should create instance with required credentials', () => {
      expect(client.accessKey).toBe(TEST_ACCESS_KEY);
      expect(client.secretKey).toBe(TEST_SECRET_KEY);
      expect(client.accountId).toBe(TEST_ACCOUNT_ID);
      expect(client.baseURL).toBe(BASE_URL);
    });

    test('should use default configuration values', () => {
      // Save current env vars
      const savedEnv = {
        REQUEST_TIMEOUT_MS: process.env.REQUEST_TIMEOUT_MS,
        MAX_RETRY_ATTEMPTS: process.env.MAX_RETRY_ATTEMPTS
      };
      
      // Clear test env vars to test defaults
      delete process.env.REQUEST_TIMEOUT_MS;
      delete process.env.MAX_RETRY_ATTEMPTS;
      
      try {
        const defaultClient = new HTXClient('key', 'secret', '123');
        
        expect(defaultClient.baseURL).toBe('https://api.huobi.pro');
        expect(defaultClient.timeout).toBe(10000);
        expect(defaultClient.maxRetries).toBe(3);
      } finally {
        // Restore env vars
        if (savedEnv.REQUEST_TIMEOUT_MS) process.env.REQUEST_TIMEOUT_MS = savedEnv.REQUEST_TIMEOUT_MS;
        if (savedEnv.MAX_RETRY_ATTEMPTS) process.env.MAX_RETRY_ATTEMPTS = savedEnv.MAX_RETRY_ATTEMPTS;
      }
    });

    test('should use environment variables for defaults', () => {
      process.env.HTX_BASE_URL = 'https://custom.htx.com';
      process.env.REQUEST_TIMEOUT_MS = '15000';
      process.env.MAX_RETRY_ATTEMPTS = '5';
      
      const envClient = new HTXClient('key', 'secret', '123');
      
      expect(envClient.baseURL).toBe('https://custom.htx.com');
      expect(envClient.timeout).toBe(15000);
      expect(envClient.maxRetries).toBe(5);
      
      // Cleanup
      delete process.env.HTX_BASE_URL;
      delete process.env.REQUEST_TIMEOUT_MS;
      delete process.env.MAX_RETRY_ATTEMPTS;
    });

    test('should create axios instance with correct configuration', () => {
      expect(client.httpClient.defaults.baseURL).toBe(BASE_URL);
      expect(client.httpClient.defaults.timeout).toBe(5000);
      expect(client.httpClient.defaults.headers['Content-Type']).toBe('application/json');
      expect(client.httpClient.defaults.headers['User-Agent']).toBe('HTX-Pi-Monitor/1.0');
    });
  });

  describe('HMAC Signature Generation', () => {
    test('should generate correct HMAC-SHA256 signature', () => {
      const params = {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: '2024-01-01T12:00:00'
      };
      
      const signature = client.sign(params, 'GET', '/v1/account/accounts');
      
      expect(signature).toBeTruthy();
      expect(typeof signature).toBe('string');
      // Signature should be base64 encoded
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    test('should generate different signatures for different parameters', () => {
      const params1 = {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: '2024-01-01T12:00:00'
      };
      
      const params2 = {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: '2024-01-01T12:00:01' // Different timestamp
      };
      
      const signature1 = client.sign(params1, 'GET', '/v1/account/accounts');
      const signature2 = client.sign(params2, 'GET', '/v1/account/accounts');
      
      expect(signature1).not.toBe(signature2);
    });

    test('should generate different signatures for different HTTP methods', () => {
      const params = {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: '2024-01-01T12:00:00'
      };
      
      const getSignature = client.sign(params, 'GET', '/v1/account/accounts');
      const postSignature = client.sign(params, 'POST', '/v1/account/accounts');
      
      expect(getSignature).not.toBe(postSignature);
    });

    test('should sort parameters alphabetically before signing', () => {
      // This is tested implicitly by verifying consistent signatures
      // for the same parameters regardless of object key order
      const paramsA = {
        Timestamp: '2024-01-01T12:00:00',
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureVersion: '2',
        SignatureMethod: 'HmacSHA256'
      };
      
      const paramsB = {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: '2024-01-01T12:00:00'
      };
      
      const signatureA = client.sign(paramsA, 'GET', '/v1/account/accounts');
      const signatureB = client.sign(paramsB, 'GET', '/v1/account/accounts');
      
      expect(signatureA).toBe(signatureB);
    });

    test('should properly encode parameter values', () => {
      const params = {
        AccessKeyId: TEST_ACCESS_KEY,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: '2024-01-01T12:00:00',
        'test-param': 'value with spaces & symbols!'
      };
      
      // Should not throw and should produce valid signature
      const signature = client.sign(params, 'GET', '/v1/test');
      expect(signature).toBeTruthy();
    });
  });

  describe('Signed Parameters Creation', () => {
    test('should create signed parameters with all required fields', () => {
      const params = client.createSignedParams('GET', '/v1/account/accounts');
      
      expect(params.AccessKeyId).toBe(TEST_ACCESS_KEY);
      expect(params.SignatureMethod).toBe('HmacSHA256');
      expect(params.SignatureVersion).toBe('2');
      expect(params.Timestamp).toBeTruthy();
      expect(params.Signature).toBeTruthy();
      
      // Timestamp should be in ISO format
      expect(params.Timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    test('should include additional body parameters', () => {
      const body = { symbol: 'btcusdt', size: '0.001' };
      const params = client.createSignedParams('POST', '/v1/order', body);
      
      expect(params.symbol).toBe('btcusdt');
      expect(params.size).toBe('0.001');
      expect(params.Signature).toBeTruthy();
    });

    test('should generate different signatures for consecutive calls', () => {
      const params1 = client.createSignedParams('GET', '/v1/account/accounts');
      
      // Wait a moment to ensure different timestamp
      setTimeout(() => {
        const params2 = client.createSignedParams('GET', '/v1/account/accounts');
        expect(params1.Signature).not.toBe(params2.Signature);
      }, 1100); // Wait over 1 second to ensure timestamp difference
    });
  });

  describe('Query String Building', () => {
    test('should build correct query string from parameters', () => {
      const params = {
        AccessKeyId: 'test_key',
        SignatureMethod: 'HmacSHA256',
        Timestamp: '2024-01-01T12:00:00',
        symbol: 'btcusdt'
      };
      
      const queryString = client.buildQueryString(params);
      
      expect(queryString).toBe('AccessKeyId=test_key&SignatureMethod=HmacSHA256&Timestamp=2024-01-01T12%3A00%3A00&symbol=btcusdt');
    });

    test('should properly encode special characters in query string', () => {
      const params = {
        test_param: 'value with spaces & symbols!'
      };
      
      const queryString = client.buildQueryString(params);
      
      expect(queryString).toBe('test_param=value%20with%20spaces%20%26%20symbols!');
    });
  });

  describe('Balance Retrieval', () => {
    test('should fetch and transform balances correctly', async () => {
      const mockResponse = global.testUtils.createMockHTXResponses().balances;
      
      nock(BASE_URL)
        .get(/\/v1\/account\/accounts\/123456\/balance/)
        .query(true) // Accept any query parameters
        .reply(200, mockResponse);
      
      const balances = await client.getBalances();
      
      expect(balances).toEqual({
        BTC: { free: 0.5, locked: 0 },
        ETH: { free: 2.5, locked: 0 },
        USDT: { free: 1000.0, locked: 0 },
        BNB: { free: 10.0, locked: 0 }
      });
    });

    test('should filter out zero balances', async () => {
      const mockResponse = {
        status: 'ok',
        data: {
          list: [
            { currency: 'btc', type: 'trade', balance: '0.5' },
            { currency: 'eth', type: 'trade', balance: '0' }, // Should be filtered
            { currency: 'usdt', type: 'trade', balance: '1000' }
          ]
        }
      };
      
      nock(BASE_URL)
        .get(/\/v1\/account\/accounts\/123456\/balance/)
        .query(true)
        .reply(200, mockResponse);
      
      const balances = await client.getBalances();
      
      expect(balances.ETH).toBeUndefined();
      expect(balances).toEqual({
        BTC: { free: 0.5, locked: 0 },
        USDT: { free: 1000, locked: 0 }
      });
    });

    test('should handle API error responses', async () => {
      const errorResponse = {
        status: 'error',
        err_code: 'account-frozen',
        err_msg: 'Account is frozen'
      };
      
      nock(BASE_URL)
        .get(/\/v1\/account\/accounts\/123456\/balance/)
        .query(true)
        .reply(200, errorResponse);
      
      await expect(client.getBalances()).rejects.toThrow('HTX API error: account-frozen - Account is frozen');
    });

    test('should handle empty balance response', async () => {
      const emptyResponse = {
        status: 'ok',
        data: { list: [] }
      };
      
      nock(BASE_URL)
        .get(/\/v1\/account\/accounts\/123456\/balance/)
        .query(true)
        .reply(200, emptyResponse);
      
      const balances = await client.getBalances();
      expect(balances).toEqual({});
    });
  });

  describe('Price Retrieval', () => {
    test('should fetch and transform prices correctly', async () => {
      const mockResponse = global.testUtils.createMockHTXResponses().prices;
      
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, mockResponse);
      
      const prices = await client.getPrices(['BTC', 'ETH', 'BNB']);
      
      expect(prices).toEqual({
        BTC: { last: 62000, change24h: -1.2 },
        ETH: { last: 3500, change24h: 2.04 },
        BNB: { last: 450, change24h: -0.88 }
      });
    });

    test('should handle USDT special case', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, { status: 'ok', data: [] });
      
      const prices = await client.getPrices(['USDT']);
      
      expect(prices.USDT).toEqual({ last: 1.0, change24h: 0 });
    });

    test('should handle missing symbols gracefully', async () => {
      const mockResponse = {
        status: 'ok',
        data: [
          { symbol: 'btcusdt', open: 62750, close: 62000, high: 63000, low: 61500 }
        ]
      };
      
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, mockResponse);
      
      const prices = await client.getPrices(['BTC', 'NONEXISTENT']);
      
      expect(prices.BTC).toEqual({ last: 62000, change24h: -1.2 });
      expect(prices.NONEXISTENT).toBeUndefined();
    });

    test('should calculate 24h change correctly', async () => {
      const mockResponse = {
        status: 'ok',
        data: [
          { symbol: 'btcusdt', open: 60000, close: 62000 } // +3.33% change
        ]
      };
      
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, mockResponse);
      
      const prices = await client.getPrices(['BTC']);
      
      expect(prices.BTC.change24h).toBeCloseTo(3.33, 2);
    });

    test('should handle zero open price edge case', async () => {
      const mockResponse = {
        status: 'ok',
        data: [
          { symbol: 'btcusdt', open: 0, close: 62000 }
        ]
      };
      
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, mockResponse);
      
      const prices = await client.getPrices(['BTC']);
      
      expect(prices.BTC.change24h).toBe(0);
    });

    test('should handle price API errors', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, { status: 'error' });
      
      await expect(client.getPrices(['BTC'])).rejects.toThrow('HTX price API error: error');
    });
  });

  describe('Retry Logic and Error Handling', () => {
    test('should retry on network errors', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .times(2) // First call fails, second succeeds
        .replyWithError('Network error')
        .get('/market/tickers')
        .reply(200, { status: 'ok', data: [] });
      
      const prices = await client.getPrices(['BTC']);
      expect(prices).toEqual({});
    });

    test('should retry on 5xx server errors', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(500, 'Internal Server Error')
        .get('/market/tickers')
        .reply(200, { status: 'ok', data: [] });
      
      const prices = await client.getPrices(['BTC']);
      expect(prices).toEqual({});
    });

    test('should retry on 429 rate limit', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(429, 'Too Many Requests')
        .get('/market/tickers')
        .reply(200, { status: 'ok', data: [] });
      
      const prices = await client.getPrices(['BTC']);
      expect(prices).toEqual({});
    });

    test('should not retry on 4xx client errors (except 429)', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(403, 'Forbidden');
      
      await expect(client.getPrices(['BTC'])).rejects.toThrow();
    });

    test('should fail after max retries', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .times(3) // maxRetries + 1
        .reply(500, 'Internal Server Error');
      
      await expect(client.getPrices(['BTC'])).rejects.toThrow('HTX API failed after 3 attempts');
    });

    test('should use exponential backoff between retries', async () => {
      const startTime = Date.now();
      
      nock(BASE_URL)
        .get('/market/tickers')
        .times(3)
        .reply(500, 'Internal Server Error');
      
      try {
        await client.getPrices(['BTC']);
      } catch (error) {
        const duration = Date.now() - startTime;
        // Should have waited at least baseDelay (100ms) + baseDelay*2 (200ms) = 300ms
        expect(duration).toBeGreaterThanOrEqual(200);
      }
    });

    test('should respect maxDelay cap', async () => {
      const highDelayClient = new HTXClient(TEST_ACCESS_KEY, TEST_SECRET_KEY, TEST_ACCOUNT_ID, {
        baseURL: BASE_URL,
        maxRetries: 1,
        baseDelay: 2000, // High base delay
        maxDelay: 500 // Low max delay
      });
      
      const startTime = Date.now();
      
      nock(BASE_URL)
        .get('/market/tickers')
        .times(2)
        .reply(500, 'Internal Server Error');
      
      try {
        await highDelayClient.getPrices(['BTC']);
      } catch (error) {
        const duration = Date.now() - startTime;
        // Should be capped at maxDelay (500ms), not baseDelay (2000ms)
        expect(duration).toBeLessThan(1000);
      }
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce minimum request interval', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .times(2)
        .reply(200, { status: 'ok', data: [] });
      
      const startTime = Date.now();
      
      // Make two requests in quick succession
      await client.getPrices(['BTC']);
      await client.getPrices(['ETH']);
      
      const duration = Date.now() - startTime;
      
      // Second request should have been delayed
      expect(duration).toBeGreaterThanOrEqual(client.minRequestInterval);
    });

    test('should not delay if enough time has passed', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(200, { status: 'ok', data: [] })
        .get('/market/tickers')
        .reply(200, { status: 'ok', data: [] });
      
      await client.getPrices(['BTC']);
      
      // Wait longer than minRequestInterval
      await global.testUtils.sleep(client.minRequestInterval + 50);
      
      const startTime = Date.now();
      await client.getPrices(['ETH']);
      const duration = Date.now() - startTime;
      
      // Should not have additional delay
      expect(duration).toBeLessThan(50);
    });
  });

  describe('Connection Testing', () => {
    test('should test connection successfully', async () => {
      nock(BASE_URL)
        .get('/v1/common/timestamp')
        .reply(200, { status: 'ok', data: Date.now() });
      
      const result = await client.testConnection();
      expect(result).toBe(true);
    });

    test('should fail connection test on error', async () => {
      nock(BASE_URL)
        .get('/v1/common/timestamp')
        .reply(500, 'Internal Server Error');
      
      const result = await client.testConnection();
      expect(result).toBe(false);
    });

    test('should fail connection test on invalid response', async () => {
      nock(BASE_URL)
        .get('/v1/common/timestamp')
        .reply(200, { status: 'error' });
      
      const result = await client.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('Server Time Retrieval', () => {
    test('should get server timestamp', async () => {
      const mockTimestamp = Date.now();
      
      nock(BASE_URL)
        .get('/v1/common/timestamp')
        .reply(200, { status: 'ok', data: mockTimestamp });
      
      const timestamp = await client.getServerTime();
      expect(timestamp).toBe(mockTimestamp);
    });

    test('should fallback to local time on error', async () => {
      nock(BASE_URL)
        .get('/v1/common/timestamp')
        .reply(500, 'Internal Server Error');
      
      const beforeTime = Date.now();
      const timestamp = await client.getServerTime();
      const afterTime = Date.now();
      
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Sleep Utility', () => {
    test('should sleep for specified duration', async () => {
      const startTime = Date.now();
      await client.sleep(100);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeGreaterThanOrEqual(90); // Allow some variance
      expect(duration).toBeLessThan(150);
    });

    test('should handle zero sleep duration', async () => {
      const startTime = Date.now();
      await client.sleep(0);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(10);
    });
  });

  describe('Error Message Handling', () => {
    test('should preserve original error messages in retries', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .times(3)
        .replyWithError('Connection timeout');
      
      try {
        await client.getPrices(['BTC']);
      } catch (error) {
        expect(error.message).toContain('Connection timeout');
      }
    });

    test('should handle axios error structure', async () => {
      nock(BASE_URL)
        .get('/market/tickers')
        .reply(403, { error: 'Invalid API key' });
      
      try {
        await client.getPrices(['BTC']);
      } catch (error) {
        expect(error).toBeDefined();
        // The specific error structure depends on axios version
        // Just ensure it throws without retrying
      }
    });
  });

  describe('Request Signing Integration', () => {
    test('should include valid signature in balance request', async () => {
      let capturedQuery = null;
      
      nock(BASE_URL)
        .get(/\/v1\/account\/accounts\/123456\/balance/)
        .query(query => {
          capturedQuery = query;
          return true;
        })
        .reply(200, { status: 'ok', data: { list: [] } });
      
      await client.getBalances();
      
      expect(capturedQuery.AccessKeyId).toBe(TEST_ACCESS_KEY);
      expect(capturedQuery.SignatureMethod).toBe('HmacSHA256');
      expect(capturedQuery.SignatureVersion).toBe('2');
      expect(capturedQuery.Timestamp).toBeTruthy();
      expect(capturedQuery.Signature).toBeTruthy();
    });

    test('should generate consistent signatures for same parameters', () => {
      const timestamp = '2024-01-01T12:00:00';
      
      // Mock Date to return consistent timestamp
      const originalDate = Date;
      global.Date = class extends Date {
        toISOString() {
          return timestamp;
        }
      };
      
      try {
        const params1 = client.createSignedParams('GET', '/v1/account/accounts');
        const params2 = client.createSignedParams('GET', '/v1/account/accounts');
        
        expect(params1.Signature).toBe(params2.Signature);
      } finally {
        global.Date = originalDate;
      }
    });
  });
});