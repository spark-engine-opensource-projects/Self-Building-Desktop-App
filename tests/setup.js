// Jest setup file
const path = require('path');

// Mock electron modules
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => path.join(__dirname, '..', 'test-data')),
    whenReady: jest.fn(() => Promise.resolve())
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    webContents: {
      openDevTools: jest.fn(),
      send: jest.fn()
    }
  })),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn()
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showErrorBox: jest.fn()
  }
}));

// Global test utilities
global.testUtils = {
  createMockLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logSecurityEvent: jest.fn(),
    logCodeGeneration: jest.fn(),
    logCodeExecution: jest.fn(),
    setCorrelationId: jest.fn(),
    generateCorrelationId: jest.fn(),
    addCorrelation: jest.fn(meta => meta)
  }),
  
  createMockConfig: () => ({
    execution: {
      maxConcurrentExecutions: 3,
      executionTimeout: 30000,
      maxMemoryMB: 512,
      maxOutputSize: 1048576
    },
    security: {
      enableResourceMonitoring: true,
      logAllExecutions: true,
      blockSuspiciousPackages: false,
      maxPromptLength: 10000
    },
    ai: {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 2000
    }
  })
};

// Console suppression for cleaner test output
const originalConsole = console;
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};