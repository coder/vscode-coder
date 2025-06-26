# Coder VSCode Extension - Quality Improvement Plan

## Phase 1: Test Infrastructure & Coverage ✅ COMPLETED

- **405 unit tests** passing with 78.49% overall coverage
- **69 integration tests** passing
- **18 files** with >90% coverage
- Established TDD workflow and testing patterns

## Phase 2: Structured Logging Implementation ✅ COMPLETED

### Completed

- [x] Logger class with levels (ERROR, WARN, INFO, DEBUG) - 98.44% coverage
- [x] VS Code output channel integration with verbose setting support
- [x] Backward compatibility via writeToCoderOutputChannel method
- [x] Test factory createMockOutputChannelWithLogger for consistent testing
- [x] Verified Logger works with existing error.ts Logger interface

### Next Steps

1. **Replace writeToCoderOutputChannel calls** (43 instances across 10 files)
   - ✅ remote.ts (18) - Completed with Logger integration test
   - ✅ extension.ts (8) - Completed with Logger initialization and test
   - ✅ headers.ts (4) - Completed via Logger interface compatibility
   - ✅ workspaceMonitor.ts (3) - Completed via Storage interface compatibility
   - ✅ inbox.ts (3) - Completed via Storage interface compatibility
   - ✅ error.ts (2) - Completed via Logger interface compatibility
   - ✅ workspacesProvider.ts (1) - Completed via Storage interface compatibility
   - ✅ commands.ts (1) - Completed via Storage interface compatibility
   - ✅ All 43 instances now use Logger through Storage or interface compatibility
2. **Add structured logging to high-value areas**
   - API calls and responses
   - Connection establishment/failures
   - Certificate errors
   - Command execution

## Phase 3: Code Quality Improvements

### Test Quality ✅ COMPLETED

- [x] test-helpers.ts with comprehensive mock factories (30+ factory functions)
- [x] Reduced `as any` casts from 95 to 4 (96% reduction)
- [x] api.test.ts cleanup - removed eslint-disable and all inline mocks
- [x] Consolidated all test mocks into reusable factory functions
- [x] Migrated all test files to use consistent mock patterns

### Refactoring Priority

1. **extension.ts** (39.71% → 93.07% coverage ✅ COMPLETED) - Refactored monolithic activate() function

   Successfully extracted all 9 helper functions using TDD:

   - [x] setupRemoteSSHExtension() - Configure remote SSH extension
   - [x] initializeInfrastructure() - Create storage and logger
   - [x] initializeRestClient() - Setup REST client
   - [x] setupTreeViews() - Create workspace providers and trees
   - [x] registerUriHandler() - Handle vscode:// URIs
   - [x] registerCommands() - Register all VS Code commands
   - [x] handleRemoteEnvironment() - Setup remote workspace if needed
   - [x] checkAuthentication() - Verify user auth and fetch workspaces
   - [x] handleAutologin() - Process autologin configuration

2. **remote.ts** (49.21% coverage) - break down 400+ line methods
3. **commands.ts** (64.19% coverage) - create UI abstraction layer

## Phase 4: Connection Reliability & API Consolidation

- [ ] Implement exponential backoff for retries
- [ ] Add connection health monitoring with Logger
- [ ] Create API/CLI abstraction layer
- [ ] Migrate to CLI-first approach where possible

## Success Metrics

| Metric                   | Target | Current | Status      |
| ------------------------ | ------ | ------- | ----------- |
| Unit test coverage       | 85%+   | 78.49%  | 🔄 Progress |
| Integration tests        | 95+    | 69      | 🔄 Progress |
| Logger adoption          | 100%   | 100%    | ✅ Complete |
| Files with <50% coverage | 0      | 1       | 🔄 Progress |
| Test mock consolidation  | 100%   | 100%    | ✅ Complete |
| Average method length    | <50    | >100    | 🔄 Progress |

## Phase 5: Integration Test Implementation

### Current State

- **94 skipped integration tests** across 11 test files
- Only 2 simple tests currently running (command existence checks)
- Integration tests use VS Code Test API, not Vitest

### Implementation Plan

#### Phase 1: Foundation Tests (High Priority) - Current Focus

1. **Authentication** (`authentication.test.ts` - 24 skipped tests)

   - Login Flow: 13 tests
   - Logout Flow: 5 tests
   - Token Management: 4 tests
   - Token validation: 2 tests

2. **Workspace Operations** (`workspace-operations.test.ts` - 23 skipped tests)
   - Open Workspace: 8 tests
   - Create/Update: 4 tests
   - Navigation: 5 tests
   - Refresh: 6 tests

#### Phase 2: Core Functionality Tests

3. **Tree Views** (`tree-views.test.ts` - 21 skipped tests)

   - Display & Updates: 8 tests
   - Tree Item Actions: 7 tests
   - Toolbar Updates: 6 tests

4. **Remote Connection** (`remote-connection.test.ts` - 36 skipped tests)
   - SSH Connection: 12 tests
   - Remote Authority: 4 tests
   - Connection Monitoring: 4 tests
   - Binary Management: 16 tests

#### Phase 3: Feature-Specific Tests

5. **Settings** (`settings.test.ts` - 15 skipped tests)
6. **Error Handling** (`error-handling.test.ts` - 17 skipped tests)
7. **DevContainer** (`devcontainer.test.ts` - 8 skipped tests)
8. **URI Handler** (`uri-handler.test.ts` - 3 skipped tests)
9. **Logs** (`logs.test.ts` - 7 skipped tests)
10. **Storage** (`storage.test.ts` - 12 skipped tests)
11. **App Status** (`app-status.test.ts` - 7 skipped tests)

### Integration Test Success Metrics

| Metric                  | Target | Current | Status         |
| ----------------------- | ------ | ------- | -------------- |
| Total integration tests | 170+   | 95      | 🔄 In Progress |
| Skipped tests           | 0      | 84      | 🔄 In Progress |
| Test coverage           | 80%+   | ~50%    | 🔄 In Progress |

### Progress Update

- ✅ **95 integration tests passing** (up from 86)
- ✅ **0 failing tests** (fixed all 4 failing tests)
- ✅ Created integration-specific test helpers without Vitest dependencies
- ✅ Applied UI automation patterns to avoid test timeouts
- 📈 **84 tests remaining to enable** (down from 94)

### UI Testing Automation Solution

- ✅ **UI Automation Helpers**: Created mock UI elements with simulation capabilities in test-helpers.ts
- 📚 **Documentation**: Added UI-TESTING-PATTERNS.md guide for UI testing patterns
- 🚀 **Implementation**: Updated authentication tests to use UI automation
- 🎯 **Benefits**: Tests can now simulate user input without pausing
- 📈 **Next Steps**: Apply UI automation patterns to remaining integration tests

## UI Testing Automation Patterns

### Added UI Automation Helpers

- ✅ Created `createMockInputBox()` - Mock InputBox with simulation methods
- ✅ Created `createMockQuickPickWithAutomation()` - Enhanced QuickPick mock
- ✅ Added `simulateInputBox()` - Helper for simulating showInputBox
- ✅ Added `simulateQuickPick()` - Helper for createQuickPick simulation
- ✅ Added `simulateShowQuickPick()` - Helper for showQuickPick simulation

### UI Automation Test Examples

- ✅ Created `ui-automation-patterns.test.ts` - Real-world pattern demonstrations
- ✅ Demonstrates QuickPick URL selection with dynamic items
- ✅ Shows InputBox password entry with validation
- ✅ Multi-step UI flows (workspace → agent selection)
- ✅ Cancellation handling and error scenarios

### Key UI Testing Patterns Demonstrated

1. **QuickPick URL Selection** - Dynamic items based on user input
2. **InputBox Token Entry** - Password fields with validation
3. **Multi-step Flows** - Workspace → Agent selection
4. **Cancellation Handling** - User pressing Escape
5. **Input Validation** - Real-time validation feedback
6. **Button Interactions** - QuickPick custom buttons

## Phase 6: Test Simplification Refactoring 🚀 NEW

### Overview

Major refactoring to dramatically improve testability by breaking down monolithic methods and creating proper abstractions.

### Sub-Phase 6.1: Break Down Monolithic Methods (Week 1-2)

#### remote.ts Refactoring (52.15% → 80%+ coverage)

- [ ] Extract `validateRemoteAuthority()` from 366-line setup() method
- [ ] Extract `authenticateRemote()` - Handle auth flow
- [ ] Extract `fetchWorkspaceDetails()` - Get workspace info
- [ ] Extract `ensureWorkspaceRunning()` - Start if needed
- [ ] Extract `configureSSHConnection()` - SSH setup
- [ ] Extract `setupBinaryManagement()` - Binary download/update
- [ ] Extract `configureLogging()` - Log directory setup
- [ ] Extract `establishConnection()` - Final connection

#### commands.ts UI Abstraction (68.03% → 80%+ coverage)

- [ ] Create `UIProvider` interface for all UI interactions
- [ ] Implement `DefaultUIProvider` using vscode APIs
- [ ] Implement `TestUIProvider` with programmable responses
- [ ] Migrate all commands to use UIProvider

### Sub-Phase 6.2: Test Infrastructure Enhancements

- [ ] Add `createMockSSHConfig()` to test-helpers.ts
- [ ] Add `createMockProcess()` for process testing
- [ ] Add `createMockFileSystem()` for file operations
- [ ] Add `createMockNetworkMonitor()` for network testing
- [ ] Create `withMockWorkspace()` integration helper
- [ ] Create `withMockAuthentication()` integration helper
- [ ] Create `withMockSSHConnection()` integration helper

### Sub-Phase 6.3: Enable Integration Tests

- [ ] Enable authentication tests (24 tests)
- [ ] Enable workspace operation tests (23 tests)
- [ ] Enable tree view tests (21 tests)
- [ ] Enable remote connection tests (36 tests)

### Sub-Phase 6.4: Implement Testing Patterns

- [ ] Create WorkspaceStateMachine for state testing
- [ ] Implement Command pattern for complex operations
- [ ] Document all new patterns in CLAUDE.md

### Success Metrics for Phase 6

| Metric                    | Current    | Target    | Status |
| ------------------------- | ---------- | --------- | ------ |
| Unit test coverage        | 78.49%     | 85%+      | 🔄     |
| Integration tests enabled | 11         | 95+       | 🔄     |
| Average method length     | >100 lines | <50 lines | 🔄     |
| Files with <50% coverage  | 1          | 0         | 🔄     |
| Test execution time       | ~3 min     | <5 min    | 🔄     |

## Immediate Next Steps (Priority)

1. **Extract validateRemoteAuthority() using TDD** - Start with remote.ts refactoring
2. **Create UIProvider interface** - Enable commands.ts testing
3. **Enable first 5 authentication tests** - Prove integration test approach
