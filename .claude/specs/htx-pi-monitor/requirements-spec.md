# HTX Pi Monitor — Technical Specification for Code Generation

## Problem Statement

- **Business Issue**: Cryptocurrency portfolio tracking requires real-time monitoring with accurate cost basis calculation to make informed trading decisions
- **Current State**: No existing implementation - greenfield development based on comprehensive architecture specification
- **Expected Outcome**: A fully functional Raspberry Pi-based portfolio monitor displaying real-time HTX balances with P/L tracking using LOFO (Lowest-First-Out) accounting

## Solution Overview

- **Approach**: Monolithic Node.js application using pull-based data synchronization with local JSON persistence
- **Core Changes**: Complete implementation from scratch following KISS and YAGNI principles
- **Success Criteria**: System operational within 2 minutes of startup, P95 response time <100ms, memory usage <100MB, 99%+ uptime

## Technical Implementation

### Project Structure
```
raspi-htx-monitor/
├── src/
│   ├── server.js        # Express app + API endpoints
│   ├── htx.js           # HTX REST client with HMAC signing
│   ├── scheduler.js     # 60-second pull cycle orchestrator
│   ├── state.js         # In-memory cache + atomic JSON writes
│   ├── calc.js          # Portfolio valuation and P/L calculations
│   └── lots.js          # LOFO accounting engine
├── public/
│   ├── index.html       # Touch-optimized UI
│   ├── style.css        # Pi display optimized CSS
│   └── script.js        # Frontend JavaScript
├── data/
│   ├── state.json       # Rolling snapshots (created at runtime)
│   └── cost_basis_lots.json  # LOFO lots with sequential IDs
├── systemd/
│   └── htx-monitor.service
├── scripts/
│   └── kiosk-setup.sh
├── .env.example
├── package.json
└── README.md
```

### Database Changes
**New JSON Files to Create:**

1. **`data/state.json`** - Rolling snapshot history
```json
{
  "history": [
    {
      "time": 1725246000,
      "ref_fiat": "USD",
      "total_value_usd": 12345.67,
      "total_change_24h_pct": -2.15,
      "positions": [
        {
          "symbol": "BTC",
          "free": 0.12,
          "price": 62000,
          "value": 7440,
          "day_pct": -1.2,
          "pnl_pct": 8.3,
          "unreconciled": false
        }
      ]
    }
  ]
}
```

2. **`data/cost_basis_lots.json`** - LOFO accounting records
```json
{
  "meta": { "last_id": 3 },
  "BTC": {
    "lots": [
      {
        "id": "000001",
        "action": "buy",
        "qty": 0.10,
        "unit_cost": 60000,
        "ts": "2025-01-01T12:00:00Z"
      },
      {
        "id": "000002",
        "action": "withdraw",
        "qty": 0.05,
        "ts": "2025-02-15T18:20:00Z"
      }
    ]
  }
}
```

### Code Changes

**Files to Create:**

#### `package.json` - Project Dependencies and Scripts
```json
{
  "name": "raspi-htx-monitor",
  "version": "1.0.0",
  "description": "HTX cryptocurrency portfolio monitor for Raspberry Pi",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest --coverage",
    "test:watch": "jest --watch",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration"
  },
  "dependencies": {
    "express": "^4.19.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "helmet": "^7.1.0",
    "compression": "^1.7.4",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0",
    "jest": "^29.7.0",
    "supertest": "^6.3.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

#### `src/htx.js` - HTX API Client
**Function Signatures to Implement:**
```javascript
class HTXClient {
  constructor(accessKey, secretKey, accountId)
  async getBalances() // Returns: {BTC: {free: 0.12, locked: 0}}
  async getPrices(symbols) // Returns: {BTC: {last: 62000, change24h: -1.2}}
  sign(params, method, hostname, path) // HMAC-SHA256 signing
  async retryWithBackoff(fn, maxRetries = 3)
}
```

**Key Implementation Details:**
- Base URL: `https://api.huobi.pro`
- Request timeout: 10 seconds
- Rate limit handling with linear backoff (base: 1s, max: 30s)
- Error codes: 429 (rate limit), 5xx (server error) trigger retry
- Time synchronization tolerance: ±5 seconds

#### `src/state.js` - State Management
**Function Signatures to Implement:**
```javascript
class StateManager {
  constructor(dataDir = './data', maxHistory = 50)
  async loadState() // Load from state.json
  async saveSnapshot(snapshot) // Atomic write with rolling history
  getLatestSnapshot() // From memory cache
  getHistory(limit = 50) // From memory cache
  async atomicWrite(filepath, data) // Temp file + rename pattern
}
```

**Critical Implementation:**
```javascript
async atomicWrite(filepath, data) {
  const tmpPath = `${filepath}.tmp.${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.rename(tmpPath, filepath);
}
```

#### `src/lots.js` - LOFO Accounting Engine
**Function Signatures to Implement:**
```javascript
class LotsManager {
  constructor(dataDir = './data')
  async loadLots() // Load cost_basis_lots.json
  async saveLotsAtomic(lotsData) // Atomic write
  nextId(meta) // Sequential ID generation: 000001, 000002, etc.
  applyEntry(lotsData, symbol, {action, qty, unit_cost, ts})
  deductLOFO(lots, qtyToDeduct) // Core LOFO algorithm
  avgCost(symbol, lotsData) // Weighted average of remaining lots
  checkReconciliation(actualQty, lots) // Balance vs lots validation
}
```

**LOFO Algorithm Implementation:**
```javascript
deductLOFO(lots, qtyToDeduct) {
  // Sort by unit_cost ascending (null = Infinity)
  lots.sort((a, b) => (a.unit_cost ?? Infinity) - (b.unit_cost ?? Infinity));
  
  let remaining = qtyToDeduct;
  for (const lot of lots) {
    if (remaining <= 0) break;
    if (lot.qty <= 0) continue;
    
    const deducted = Math.min(lot.qty, remaining);
    lot.qty -= deducted;
    remaining -= deducted;
  }
  
  // Remove depleted lots (qty <= 1e-12)
  return lots.filter(lot => lot.qty > 1e-12);
}
```

#### `src/calc.js` - Portfolio Calculator
**Function Signatures to Implement:**
```javascript
class Calculator {
  computeSnapshot(balances, prices, lotsData)
  calculatePosition(symbol, balance, price, dayChange, avgCost)
  calculateWeightedChange(positions, totalValue)
  getAverageCost(symbol, lotsData)
  checkReconciliation(balance, lots)
}
```

**Core Calculation Logic:**
```javascript
computeSnapshot(balances, prices, lotsData) {
  const positions = [];
  let totalValue = 0;
  let weightedChange = 0;
  
  for (const [symbol, balance] of Object.entries(balances)) {
    const price = prices[symbol]?.last || 0;
    const value = balance.free * price;
    const avgCost = this.getAverageCost(symbol, lotsData);
    const pnlPct = avgCost ? ((price / avgCost - 1) * 100) : null;
    
    positions.push({
      symbol,
      free: balance.free,
      price,
      value,
      day_pct: prices[symbol]?.change24h || 0,
      pnl_pct: pnlPct,
      unreconciled: this.checkReconciliation(balance.free, lotsData[symbol])
    });
    
    totalValue += value;
    weightedChange += value * (prices[symbol]?.change24h || 0);
  }
  
  return {
    time: Math.floor(Date.now() / 1000),
    ref_fiat: 'USD',
    total_value_usd: totalValue,
    total_change_24h_pct: totalValue ? (weightedChange / totalValue) : 0,
    positions
  };
}
```

#### `src/scheduler.js` - Pull Orchestrator
**Function Signatures to Implement:**
```javascript
class Scheduler {
  constructor(htxClient, stateManager, lotsManager, calculator, intervalMs = 60000)
  start() // Begin pull cycle
  stop() // Graceful shutdown
  async pullCycle() // Single pull execution
  handleError(error) // Backoff strategy
}
```

**Error Recovery Implementation:**
```javascript
handleError(error) {
  this.failureCount++;
  const backoffMs = Math.min(this.failureCount * 30000, 300000); // Max 5 minutes
  console.error(`Pull failed, retry in ${backoffMs}ms:`, error.message);
  this.nextPullTime = Date.now() + backoffMs;
}
```

#### `src/server.js` - Express Server
**Function Signatures to Implement:**
```javascript
class Server {
  constructor(port = 8080, bindAddr = '0.0.0.0', stateManager)
  setupMiddleware() // Helmet, compression, morgan, static files
  setupRoutes() // API endpoints
  start() // Server startup
  stop() // Graceful shutdown
}
```

### API Changes

**Endpoints to Implement:**

1. **`GET /api/health`**
```javascript
// Response format:
{
  "ok": true,
  "now": 1725246000,
  "lastSnapshotAt": 1725245940,
  "uptime": 3600,
  "version": "1.0.0"
}
```

2. **`GET /api/snapshot`**
```javascript
// Returns latest snapshot from state.json format
{
  "time": 1725246000,
  "ref_fiat": "USD",
  "total_value_usd": 12345.67,
  "total_change_24h_pct": -2.15,
  "positions": [...]
}
```

3. **`GET /api/history?n=50`**
```javascript
// Returns historical snapshots
{
  "history": [
    // Array of snapshots (newest first)
  ]
}
```

**Request/Response Formats:**
- All responses: `Content-Type: application/json`
- Error responses: `{"error": "Error message"}` with appropriate HTTP status
- Success responses: Direct data object

**Validation Rules:**
- `n` parameter: integer, 1-100, default 50
- All numeric values: validate finite numbers
- Timestamps: Unix seconds, validate reasonable range

### Configuration Changes

**Environment Variables to Add:**
```bash
# Server Configuration
PORT=8080
BIND_ADDR=0.0.0.0
REF_FIAT=USD
PULL_INTERVAL_MS=60000

# HTX API Credentials (READ-ONLY)
HTX_ACCESS_KEY=your_access_key
HTX_SECRET_KEY=your_secret_key
HTX_ACCOUNT_ID=your_account_id

# Feature Flags
ENABLE_COST_MANUAL=true
ENABLE_LOTS_LOFO=true
ENABLE_HISTORY_PULL=false
ENABLE_FEES=false

# Data Configuration
MAX_HISTORY_SNAPSHOTS=50
DATA_DIR=./data

# Performance Tuning
REQUEST_TIMEOUT_MS=10000
MAX_RETRY_ATTEMPTS=3
BACKOFF_BASE_MS=1000
BACKOFF_MAX_MS=300000
```

**`.env.example` File:**
```bash
# Copy to .env and fill in your values

# Server Configuration
PORT=8080
BIND_ADDR=0.0.0.0
REF_FIAT=USD
PULL_INTERVAL_MS=60000

# HTX API Credentials (GET READ-ONLY KEYS FROM HTX)
HTX_ACCESS_KEY=
HTX_SECRET_KEY=
HTX_ACCOUNT_ID=

# Feature Flags (MVP settings)
ENABLE_COST_MANUAL=true
ENABLE_LOTS_LOFO=true
ENABLE_HISTORY_PULL=false
ENABLE_FEES=false
```

### Frontend Specification

**`public/index.html` Structure:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HTX Portfolio Monitor</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="app">
        <!-- Header with totals -->
        <header id="portfolio-header">
            <h1>HTX Portfolio</h1>
            <div id="total-value">$0.00</div>
            <div id="total-change">0.00%</div>
            <button id="refresh-btn">↻</button>
        </header>
        
        <!-- Controls -->
        <div id="controls">
            <select id="sort-select">
                <option value="value">Sort by Value</option>
                <option value="symbol">Sort by Symbol</option>
                <option value="change">Sort by Change</option>
                <option value="pnl">Sort by P/L</option>
            </select>
        </div>
        
        <!-- Position cards -->
        <main id="positions-container">
            <!-- Position cards inserted here -->
        </main>
        
        <!-- Status footer -->
        <footer id="status">
            <span id="last-update">Never</span>
            <span id="connection-status">●</span>
        </footer>
    </div>
    <script src="script.js"></script>
</body>
</html>
```

**Touch Interactions:**
- **Tap**: Select/highlight position
- **Double-tap**: Pin/unpin to top
- **Long-press**: Hide position
- **Swipe**: Navigation (future)
- **Pull-down**: Manual refresh

**CSS Optimizations for Pi Display:**
- Font size: 16px+ for readability
- Touch targets: 44px+ minimum
- High contrast colors
- Responsive grid layout
- No hover states (touch-only)

**JavaScript Functionality:**
```javascript
class PortfolioUI {
  constructor() {
    this.sortBy = 'value';
    this.pinnedAssets = new Set();
    this.hiddenAssets = new Set();
    this.autoRefreshInterval = 30000; // 30 seconds
  }
  
  async fetchSnapshot() {
    // GET /api/snapshot
  }
  
  renderPositions(positions) {
    // Create position cards with touch handlers
  }
  
  sortPositions(positions, sortBy) {
    // Sort with pinned assets at top
  }
  
  handleTouchEvents() {
    // Touch gesture recognition
  }
  
  startAutoRefresh() {
    // Auto-refresh every 30 seconds
  }
}
```

## Implementation Sequence

### Phase 1: Project Foundation
1. **Initialize project structure**
   - Create directory tree
   - Set up package.json with dependencies
   - Create .env.example template
   - Initialize git repository

2. **Environment setup**
   - Configure dotenv loading
   - Create data directory
   - Set up logging infrastructure
   - Validate required environment variables

### Phase 2: Core Backend Modules
1. **Implement HTX client (`src/htx.js`)**
   - HMAC-SHA256 signing function
   - Balance fetching with error handling
   - Price fetching for USDT pairs
   - Retry logic with exponential backoff

2. **Implement state manager (`src/state.js`)**
   - Atomic write operations
   - Rolling history management
   - Memory cache implementation
   - File system error handling

3. **Implement LOFO manager (`src/lots.js`)**
   - Sequential ID generation
   - LOFO deduction algorithm
   - Average cost calculation
   - Reconciliation checking

### Phase 3: Business Logic
1. **Implement calculator (`src/calc.js`)**
   - Portfolio valuation logic
   - P/L calculation with LOFO integration
   - Weighted 24h change calculation
   - Position aggregation and formatting

2. **Implement scheduler (`src/scheduler.js`)**
   - 60-second pull cycle
   - Error recovery with backoff
   - Graceful startup and shutdown
   - Pull cycle orchestration

### Phase 4: API Layer
1. **Implement Express server (`src/server.js`)**
   - Middleware configuration (helmet, compression, morgan)
   - Static file serving for frontend
   - Health check endpoint
   - Snapshot and history endpoints

2. **API endpoint implementations**
   - `/api/health` with system status
   - `/api/snapshot` with latest data
   - `/api/history` with pagination
   - Error handling middleware

### Phase 5: Frontend Implementation
1. **Create HTML structure (`public/index.html`)**
   - Responsive layout for Pi display
   - Touch-optimized controls
   - Position card templates
   - Status indicators

2. **Implement CSS styling (`public/style.css`)**
   - Pi display optimization
   - Touch-friendly sizing
   - High contrast colors
   - Responsive grid layout

3. **Create JavaScript functionality (`public/script.js`)**
   - Auto-refresh mechanism
   - Touch event handlers
   - Sorting and filtering
   - Asset pinning/hiding

### Phase 6: System Integration
1. **Create systemd service (`systemd/htx-monitor.service`)**
   - Service definition for auto-start
   - Restart policies
   - Logging configuration
   - User permissions

2. **Create kiosk setup script (`scripts/kiosk-setup.sh`)**
   - Chromium kiosk mode configuration
   - Screen blanking disable
   - Auto-start on boot
   - Display optimization

Each phase should be independently testable and deployable.

## Validation Plan

### Unit Tests
**Test Files to Create:**
- `test/unit/htx.test.js` - HMAC signing, API parsing, retry logic
- `test/unit/lots.test.js` - LOFO algorithm, ID generation, reconciliation
- `test/unit/calc.test.js` - Portfolio calculations, P/L accuracy, edge cases
- `test/unit/state.test.js` - Atomic writes, rolling history, memory management

**Specific Test Scenarios:**
```javascript
// LOFO deduction test
test('should deduct from lowest cost lots first', () => {
  const lots = [
    {id: '000001', qty: 0.10, unit_cost: 60000},
    {id: '000002', qty: 0.20, unit_cost: 55000}
  ];
  const result = lotsManager.deductLOFO(lots, 0.15);
  expect(result[0]).toMatchObject({id: '000002', qty: 0.05, unit_cost: 55000});
});

// P/L calculation test
test('should calculate correct P/L percentage', () => {
  const avgCost = 56666.67; // Weighted average
  const currentPrice = 62000;
  const pnlPct = ((currentPrice / avgCost - 1) * 100);
  expect(pnlPct).toBeCloseTo(9.41, 1);
});
```

### Integration Tests
**Test Files to Create:**
- `test/integration/api.test.js` - End-to-end API testing with Supertest
- `test/integration/scheduler.test.js` - Pull cycle testing with mocked HTX
- `test/integration/persistence.test.js` - File system operations, atomic writes

### Business Logic Verification
**Acceptance Tests:**
1. **Two buys + one withdraw (LOFO)**: Verify correct lot deduction order
2. **Deposit with unknown cost**: Handle null unit_cost appropriately
3. **Missing ticker data**: Graceful degradation without P/L calculation
4. **Reconciliation gap**: Flag unreconciled positions in UI
5. **Power loss during write**: Atomic write integrity verification

### Performance Validation
**Stress Test Requirements:**
- Sustain 10 RPS for 60 seconds
- P95 response time <100ms
- Memory usage <100MB
- Success rate >99%
- Recovery from simulated failures

**Memory Leak Detection:**
- Monitor heap size over 24-hour period
- Verify garbage collection effectiveness
- Check for circular references
- Validate cache size limits

This technical specification provides complete implementation details for automatic code generation, ensuring all requirements are met while maintaining the KISS and YAGNI principles specified in the original architecture.