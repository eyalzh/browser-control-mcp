// Jest setup file for browser API mocking

// Mock the browser API completely
const mockBrowser = {
  tabs: {
    create: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
    get: jest.fn(),
    executeScript: jest.fn(),
    move: jest.fn(),
    update: jest.fn(),
    group: jest.fn(),
  },
  tabGroups: {
    update: jest.fn(),
  },
  history: {
    search: jest.fn(),
  },
  find: {
    find: jest.fn(),
    highlightResults: jest.fn(),
  },
  storage: {
    local: {
        get: jest.fn(),
        set: jest.fn(),
    },
  },
  permissions: {
    contains: jest.fn(),
  },
  runtime: {
    getURL: jest.fn(),
  },
};

// Override the global browser object
Object.defineProperty(global, 'browser', {
  value: mockBrowser,
  writable: true,
  configurable: true,
});

// Export for use in tests
export { mockBrowser };
