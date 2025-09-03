# HTX Pi Monitor — Repository Context Analysis

## Current State
- **Status**: Specification-only repository (no implementation)
- **Documentation**: Complete technical specs and test plans available
- **Ready for**: Immediate implementation based on comprehensive specifications

## Project Type
- Single-platform cryptocurrency portfolio monitor
- Target: Raspberry Pi with touch interface
- Integration: HTX (Huobi) exchange only
- Architecture: Monolithic Node.js application

## Technology Stack (Planned)
- Runtime: Node.js 20+
- Framework: Express 4.19+
- Testing: Jest 29.7+
- Persistence: JSON files with atomic writes
- UI: Touch-optimized HTML/CSS/JS

## Key Design Decisions
- KISS principle throughout
- JSON persistence (no database)
- Pull-based data synchronization
- LOFO accounting for cost basis
- Sequential ID generation (000001, 000002, etc.)
- Atomic file operations for data integrity

## Implementation Requirements
1. HTX API client with HMAC-SHA256 signing
2. Scheduler for periodic data pulls
3. LOFO accounting engine
4. Portfolio calculator with P/L tracking
5. State manager with atomic persistence
6. REST API endpoints
7. Touch-optimized UI
8. Comprehensive test suite

## Performance Targets
- Response time: P95 < 100ms
- Memory usage: < 100MB
- Throughput: 10 RPS sustained
- Update interval: 60 seconds

## Security Considerations
- Read-only API keys required
- No external authentication (LAN trust)
- Automatic credential redaction in logs
- Helmet.js for security headers

## Next Steps
Begin implementation following the existing specifications in IMPLEMENTATION_SPEC.md and TEST_SPECIFICATION.md.