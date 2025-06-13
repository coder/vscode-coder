# Testing Improvement TODO

This document outlines the comprehensive testing improvements needed for the VSCode Coder extension, focusing on achieving better test coverage and code quality.

## Current Testing Status

✅ **Files with existing tests (8 files):**
- `src/util.test.ts` (8 tests)
- `src/featureSet.test.ts` (2 tests) 
- `src/sshSupport.test.ts` (9 tests)
- `src/sshConfig.test.ts` (14 tests)
- `src/headers.test.ts` (9 tests)
- `src/error.test.ts` (11 tests)
- `src/cliManager.test.ts` (6 tests)
- `src/api.test.ts` (43 tests) - ✅ COMPREHENSIVE COVERAGE

**Total: 102 tests passing**

## Priority 1: Core API Module Testing

### ✅ `src/api.ts` - Complete Test Suite (COMPLETED)

**Functions with existing tests:**

1. **`needToken()`** ✅ - Configuration-based token requirement logic
   - ✅ Test with mTLS enabled (cert + key files present)
   - ✅ Test with mTLS disabled (no cert/key files)
   - ✅ Test with partial mTLS config (cert only, key only)
   - ✅ Test with empty/whitespace config values

2. **`createHttpAgent()`** ✅ - HTTP agent configuration
   - ✅ Test proxy configuration with different proxy settings
   - ✅ Test TLS certificate loading (cert, key, CA files)
   - ✅ Test insecure mode vs secure mode
   - ✅ Test alternative hostname configuration
   - ✅ Mock file system operations

3. **`startWorkspaceIfStoppedOrFailed()`** ✅ - Workspace lifecycle management
   - ✅ Test with already running workspace (early return)
   - ✅ Test successful workspace start process
   - ✅ Test workspace start failure scenarios
   - ✅ Test stdout/stderr handling and output formatting
   - ✅ Test process exit codes and error messages
   - ✅ Mock child process spawning

**Newly added tests:**

4. **`makeCoderSdk()`** ✅ - SDK instance creation and configuration
   - ✅ Test with valid token authentication
   - ✅ Test without token (mTLS authentication)
   - ✅ Test header injection from storage
   - ✅ Test request interceptor functionality
   - ✅ Test response interceptor and error wrapping
   - ✅ Mock external dependencies (Api, Storage)

5. **`createStreamingFetchAdapter()`** ✅ - Streaming fetch adapter
   - ✅ Test successful stream creation and data flow
   - ✅ Test error handling during streaming
   - ✅ Test stream cancellation
   - ✅ Test different response status codes
   - ✅ Test header extraction
   - ✅ Mock AxiosInstance responses

6. **`waitForBuild()`** ✅ - Build monitoring and log streaming
   - ✅ Test initial log fetching
   - ✅ Test WebSocket connection for follow logs
   - ✅ Test log streaming and output formatting  
   - ✅ Test WebSocket error handling
   - ✅ Test build completion detection
   - ✅ Mock WebSocket and API responses

**Note:** Helper functions `getConfigString()` and `getConfigPath()` are internal and tested indirectly through the public API functions.

**Test Infrastructure Needs:**
- Mock VSCode workspace configuration
- Mock file system operations (fs/promises)
- Mock child process spawning
- Mock WebSocket connections
- Mock Axios instances and responses
- Mock Storage interface

## Priority 2: Missing Test Files

### ✅ `src/api-helper.ts` - Error handling utilities (COMPLETED)
- ✅ Test `errToStr()` function with various error types - 100% coverage
- ✅ Test `extractAgents()` and `extractAllAgents()` functions - 100% coverage  
- ✅ Test Zod schema validation for agent metadata - 100% coverage

### ✅ `src/commands.ts` - VSCode command implementations (COMPLETED)
- ✅ Test workspace operations (openFromSidebar, open, openDevContainer) - 56% coverage
- ✅ Test basic functionality (login, logout, viewLogs) - 56% coverage
- ✅ Test error handling scenarios - 56% coverage
- ✅ Mock VSCode command API - 56% coverage

### ✅ `src/extension.ts` - Extension entry point (COMPLETED)
- ✅ Main extension activation function (activate()) - 93.44% coverage
- ✅ Extension registration and command binding - 93.44% coverage
- ✅ URI handler for vscode:// protocol - 93.44% coverage
- ✅ Remote SSH extension integration - 93.44% coverage
- ✅ Extension context and lifecycle management - 93.44% coverage
- ✅ Helper function refactoring for testability - 93.44% coverage

### ✅ `src/storage.ts` - Data persistence (COMPLETED)
- ✅ Session token storage/retrieval (secrets API) - 89.19% coverage
- ✅ URL history management (memento API) - 89.19% coverage
- ✅ CLI configuration and binary management - 89.19% coverage
- ✅ File system operations and downloads - 89.19% coverage
- ✅ Mock setup for VSCode APIs and file system - 89.19% coverage

### ✅ `src/workspacesProvider.ts` - VSCode tree view provider (COMPLETED)
- ✅ Tree data provider implementation for sidebar - ~60% coverage estimated
- ✅ Workspace polling and refresh logic - ~60% coverage estimated
- ✅ Basic WorkspaceTreeItem functionality - ~60% coverage estimated
- ✅ 18 passing tests covering core functionality
- ⚠️ 4 tests need fixes for mocking issues (EventEmitter, timing)

### 🔴 `src/remote.ts` - Remote connection handling ⭐ **MEDIUM PRIORITY**
- **Complex**: SSH connection setup and management
- **Complex**: Workspace lifecycle (start/stop/monitor)
- **Complex**: CLI integration and process management
- **Key Dependencies**: Storage, Commands, API integration

### 🔴 `src/proxy.ts` - Proxy configuration ⭐ **LOW PRIORITY**
- **Utility**: HTTP proxy URL resolution
- **Utility**: NO_PROXY bypass logic
- **Simple**: Environment variable handling
- **Standalone**: Minimal dependencies

### 🔴 `src/inbox.ts` - Message handling ⭐ **LOW PRIORITY**
- **Utility**: Message queuing and processing
- **Simple**: Event-based messaging system
- **Standalone**: Minimal dependencies

### 🔴 `src/workspaceMonitor.ts` - Workspace monitoring ⭐ **LOW PRIORITY**
- **Utility**: Workspace state tracking
- **Simple**: File watching and change detection
- **Dependencies**: Limited to file system operations

## Priority 3: Test Quality Improvements

### 🔧 Existing Test Enhancements

1. **Increase coverage in existing test files:**
   - Add edge cases and error scenarios
   - Test async/await error handling
   - Add integration test scenarios

2. **Improve test structure:**
   - Group related tests using `describe()` blocks
   - Add setup/teardown with `beforeEach()`/`afterEach()`
   - Consistent test naming conventions

3. **Add performance tests:**
   - Test timeout handling
   - Test concurrent operations
   - Memory usage validation

## Priority 4: Test Infrastructure

### 🛠 Testing Utilities

1. **Create test helpers:**
   - Mock factory functions for common objects
   - Shared test fixtures and data
   - Custom matchers for VSCode-specific assertions

2. **Add test configuration:**
   - Test environment setup
   - Coverage reporting configuration
   - CI/CD integration improvements

3. **Mock improvements:**
   - Better VSCode API mocking
   - File system operation mocking
   - Network request mocking

## Implementation Strategy

### Phase 1: `src/api.ts` Complete Coverage (Week 1)
- Create `src/api.test.ts` with comprehensive test suite
- Focus on the 6 main functions with all edge cases
- Set up necessary mocks and test infrastructure

### Phase 2: Core Extension Files (Week 2)
- `src/extension.ts` - Entry point testing
- `src/commands.ts` - Command handler testing
- `src/storage.ts` - Persistence testing

### Phase 3: Remaining Modules (Week 3)
- All remaining untested files
- Integration between modules
- End-to-end workflow testing

### Phase 4: Quality & Coverage (Week 4)
- Achieve >90% code coverage
- Performance and reliability testing
- Documentation of testing patterns

## Testing Standards

- Use Vitest framework (already configured)
- Follow existing patterns from current test files
- Mock external dependencies (VSCode API, file system, network)
- Test both success and failure scenarios
- Include async/await error handling tests
- Use descriptive test names and organize with `describe()` blocks
- Maintain fast test execution (all tests should run in <5 seconds)

## Success Metrics

- [ ] All 17 source files have corresponding test files
- [ ] `src/api.ts` achieves >95% code coverage
- [ ] All tests pass in CI mode (`yarn test:ci`)
- [ ] Test execution time remains under 5 seconds
- [ ] Zero flaky tests (consistent pass/fail results)

---

**Next Action:** ✅ COMPLETED - `src/api.test.ts` now has comprehensive test coverage with 43 tests covering all exported functions. Next priority: Start implementing tests for `src/api-helper.ts` and other untested modules.