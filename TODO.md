# Coder VSCode Extension - Quality Improvement Plan

## Phase 1: Test Infrastructure & Coverage ✅ COMPLETED

- **359 unit tests** passing with 74.35% overall coverage
- **69 integration tests** passing
- **18 files** with >90% coverage
- Established TDD workflow and testing patterns

## Phase 2: Structured Logging Implementation 🔄 IN PROGRESS

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
   - Remaining: error.ts (2), workspacesProvider.ts (1), commands.ts (1)
   - Use TDD approach: write test → implement → verify
2. **Add structured logging to high-value areas**
   - API calls and responses
   - Connection establishment/failures
   - Certificate errors
   - Command execution

## Phase 3: Code Quality Improvements

### Test Quality

- [x] test-helpers.ts with type-safe mock builders
- [x] Removed most `as any` casts from tests
- [ ] api.test.ts cleanup (30+ `as any` with eslint-disable)
- [ ] Fix private property access in remaining test files

### Refactoring Priority

1. **extension.ts** (38.68% coverage) - extract initialization logic
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
| Unit test coverage       | 80%+   | 74.43%  | 🔄 Progress |
| Integration tests        | 60+    | 69      | ✅ Complete |
| Logger adoption          | 100%   | 85%     | 🔄 Progress |
| Files with <50% coverage | 0      | 3       | 🔄 Progress |

## Immediate Next Steps

1. **Continue Logger integration** using TDD approach

   - Start with remote.ts (18 calls) - highest impact
   - Add structured data (request IDs, durations, errors)
   - Maintain backward compatibility

2. **Clean up api.test.ts**

   - Remove eslint-disable comment
   - Create proper mock types for 30+ `as any` casts
   - Consider exposing test interfaces for better type safety

3. **Improve low-coverage files**
   - extension.ts: 38.68% → 60%+ (extract initialization)
   - remote.ts: 49.21% → 70%+ (break down large methods)
   - commands.ts: 64.19% → 75%+ (UI abstraction)
