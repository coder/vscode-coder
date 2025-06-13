# Testing Improvement TODO

This document outlines the comprehensive testing improvements needed for the VSCode Coder extension, focusing on achieving better test coverage and code quality.

## Current Testing Status

✅ **Files with existing tests (7 files):**
- `src/util.test.ts` (8 tests)
- `src/featureSet.test.ts` (2 tests) 
- `src/sshSupport.test.ts` (9 tests)
- `src/sshConfig.test.ts` (14 tests)
- `src/headers.test.ts` (9 tests)
- `src/error.test.ts` (11 tests)
- `src/cliManager.test.ts` (6 tests)

**Total: 59 tests passing**

## Priority 1: Core API Module Testing

### 🎯 `src/api.ts` - Complete Test Suite (FOCUS)

**Functions needing comprehensive tests:**

1. **`needToken()`** - Configuration-based token requirement logic
   - Test with mTLS enabled (cert + key files present)
   - Test with mTLS disabled (no cert/key files)
   - Test with partial mTLS config (cert only, key only)
   - Test with empty/whitespace config values

2. **`createHttpAgent()`** - HTTP agent configuration
   - Test proxy configuration with different proxy settings
   - Test TLS certificate loading (cert, key, CA files)
   - Test insecure mode vs secure mode
   - Test file reading errors and fallbacks
   - Test alternative hostname configuration
   - Mock file system operations

3. **`makeCoderSdk()`** - SDK instance creation and configuration
   - Test with valid token authentication
   - Test without token (mTLS authentication)
   - Test header injection from storage
   - Test request interceptor functionality
   - Test response interceptor and error wrapping
   - Mock external dependencies (Api, Storage)

4. **`createStreamingFetchAdapter()`** - Streaming fetch adapter
   - Test successful stream creation and data flow
   - Test error handling during streaming
   - Test stream cancellation
   - Test different response status codes
   - Test header extraction
   - Mock AxiosInstance responses

5. **`startWorkspaceIfStoppedOrFailed()`** - Workspace lifecycle management
   - Test with already running workspace (early return)
   - Test successful workspace start process
   - Test workspace start failure scenarios
   - Test stdout/stderr handling and output formatting
   - Test process exit codes and error messages
   - Mock child process spawning

6. **`waitForBuild()`** - Build monitoring and log streaming
   - Test initial log fetching
   - Test WebSocket connection for follow logs
   - Test log streaming and output formatting  
   - Test WebSocket error handling
   - Test build completion detection
   - Mock WebSocket and API responses

**Test Infrastructure Needs:**
- Mock VSCode workspace configuration
- Mock file system operations (fs/promises)
- Mock child process spawning
- Mock WebSocket connections
- Mock Axios instances and responses
- Mock Storage interface

## Priority 2: Missing Test Files

### 🔴 `src/api-helper.ts` - Error handling utilities
- Test `errToStr()` function with various error types
- Test error message formatting and sanitization

### 🔴 `src/commands.ts` - VSCode command implementations  
- Test all command handlers
- Test command registration and lifecycle
- Mock VSCode command API

### 🔴 `src/extension.ts` - Extension entry point
- Test extension activation/deactivation
- Test command registration
- Test provider registration
- Mock VSCode extension API

### 🔴 `src/inbox.ts` - Message handling
- Test message queuing and processing
- Test different message types

### 🔴 `src/proxy.ts` - Proxy configuration
- Test proxy URL resolution
- Test bypass logic
- Test different proxy configurations

### 🔴 `src/remote.ts` - Remote connection handling
- Test remote authority resolution
- Test connection establishment
- Test error scenarios

### 🔴 `src/storage.ts` - Data persistence
- Test header storage and retrieval
- Test configuration persistence
- Mock file system operations

### 🔴 `src/workspaceMonitor.ts` - Workspace monitoring
- Test workspace state tracking
- Test change detection and notifications

### 🔴 `src/workspacesProvider.ts` - VSCode tree view provider
- Test workspace tree construction
- Test refresh logic
- Test user interactions
- Mock VSCode tree view API

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

**Next Action:** Start with `src/api.test.ts` implementation focusing on the `needToken()` and `createHttpAgent()` functions first.