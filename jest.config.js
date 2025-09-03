module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Root directory
  rootDir: '.',
  
  // Test directories
  testMatch: [
    '<rootDir>/test/**/*.test.js',
    '<rootDir>/test/**/*.spec.js'
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js', // Skip server entry point
    '!**/node_modules/**',
    '!**/test/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Module paths
  modulePaths: ['<rootDir>/src'],
  
  // Test timeout (10 seconds)
  testTimeout: 10000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Transform configuration (if needed for ES modules)
  transform: {},
  
  // Mock configuration (removed invalid option)
  
  // Global setup/teardown
  // globalSetup: '<rootDir>/test/global-setup.js',
  // globalTeardown: '<rootDir>/test/global-teardown.js',
  
  // Test result processor
  testResultsProcessor: undefined,
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/'
  ],
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles for cleanup debugging
  detectOpenHandles: true,
  
  // Error handling
  errorOnDeprecated: false,
  
  // Max workers for parallel execution
  maxWorkers: '50%'
};