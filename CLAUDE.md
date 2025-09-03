# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HTX Pi Monitor is a real-time cryptocurrency portfolio monitor designed for Raspberry Pi. It tracks HTX exchange balances with LOFO cost basis tracking for P/L calculations. The system is optimized for limited resources (~100MB RAM) and features a touch-optimized UI.

## Key Commands

### Development
```bash
# Start development server with auto-reload
npm run dev

# Clean start (kills port 8080 first)
npm run dev:clean

# Production start
npm start

# Kill port 8080 if occupied
npm run kill-port
```

### Testing
```bash
# Run all tests with coverage
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Watch mode for development
npm run test:watch

# Stress testing
npm run test:stress

# Mock HTX server for testing
npm run test:mock-server
```

### Debugging
```bash
# Enable debug logging
# Set DEBUG=true in .env file

# Check server logs
# Logs appear in console when running npm run dev

# API endpoints for debugging:
# GET /api/status - Full system status
# GET /api/snapshot - Latest portfolio snapshot
# GET /api/health - Health check
```

## Architecture & Core Components

### Monolithic Architecture
- Single Node.js application following KISS principle
- JSON file persistence (no database needed)
- Pull-based data synchronization (60-second cycles)
- Client-side rendering to reduce Pi server load

### Core Module Responsibilities

**HTXClient (`src/htx.js`)**
- HMAC-SHA256 signed API requests
- Exponential backoff retry logic
- Rate limiting (100ms between requests)
- Handles authentication errors and network failures

**Scheduler (`src/scheduler.js`)**
- Orchestrates 60-second pull cycles
- Manages failure recovery with exponential backoff
- Tracks metrics (success rate, pull duration)
- Coordinates: HTX fetch → Calculator → State save

**Calculator (`src/calc.js`)**
- LOFO (Lowest-First-Out) cost basis calculation
- P/L computation with reconciliation
- Portfolio aggregation and 24h change tracking
- Handles unreconciled positions (no cost basis)

**StateManager (`src/state.js`)**
- Atomic file operations (power-loss resistant)
- Snapshot history management (default 50 snapshots)
- Temporary file strategy with atomic rename
- Cache management for memory efficiency

**LotsManager (`src/lots.js`)**
- Manual cost basis entry management
- LOFO accounting for P/L calculations
- JSON persistence with validation
- Sequential ID generation

**Server (`src/server.js`)**
- Express server with security middleware (Helmet)
- Static file serving for frontend
- RESTful API endpoints
- Graceful shutdown handling

### Frontend Architecture

**PortfolioUI (`public/script.js`)**
- Singleton pattern for UI management
- Safe DOM manipulation with null checks
- Auto-refresh with configurable intervals
- Pull-to-refresh touch gesture support
- Local storage for user preferences

## Important Configuration

### Environment Variables (.env)
```
HTX_ACCESS_KEY=     # Required: HTX API access key
HTX_SECRET_KEY=     # Required: HTX API secret key  
HTX_ACCOUNT_ID=     # Required: HTX account ID
PULL_INTERVAL_MS=100000  # Default: 100 seconds (was 60000)
DEBUG=false         # Set to true for verbose logging
```

### Nodemon Configuration
The `nodemon.json` watches both `src/` and `public/` directories for auto-reload during development. Ignores `data/` directory to prevent restart loops from state file updates.

## Common Issues & Solutions

### Frontend JavaScript Errors
All DOM manipulation methods include null checks. If adding new UI features, always check element existence before accessing properties:
```javascript
if (element) {
    element.textContent = value;
}
```

### Nodemon Restart Loops
Caused by writing to watched directories. Solution: Ensure `data/` is in nodemon ignore list.

### Port Already in Use
Use `npm run kill-port` or `npm run dev:clean` to clear port 8080 before starting.

### HTX API Errors
- Check credentials in .env file
- Verify API key has read permissions
- Check IP whitelist on HTX if applicable
- Enable DEBUG=true for detailed error messages

## Data Flow

1. **Pull Cycle**: Scheduler triggers every 100 seconds
2. **Data Fetch**: HTXClient fetches balances and prices
3. **Calculation**: Calculator computes P/L using LOFO lots
4. **Persistence**: StateManager saves snapshot atomically
5. **API Response**: Server provides latest snapshot to frontend
6. **UI Update**: Frontend renders portfolio with formatting

## Testing Approach

- **Unit tests**: Individual module logic (`test/unit/`)
- **Integration tests**: Module interactions (`test/integration/`)
- **E2E tests**: Full system flows (`test/e2e/`)
- **Stress tests**: Performance under load (`test/stress/`)

Mock HTX server available for isolated testing without real API calls.

## Performance Considerations

- Memory target: <100MB on Raspberry Pi
- State file rotation: Keep 50 snapshots by default
- Rate limiting: 100ms between HTX API requests
- Frontend refresh: 60-second default interval
- Atomic file operations prevent corruption on power loss