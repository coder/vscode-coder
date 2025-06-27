# VSCode Coder Extension - Remaining Work

## Current Status

- **405 unit tests** (78.49% coverage)
- **69 integration tests** passing
- **1 file** <50% coverage (remote.ts)

## Major Initiatives

### 1. Refactor Monolithic Methods

- [ ] **remote.ts** (49.51% → 80%+) - Break down 366-line setup() method
- [ ] **commands.ts** (68.03% → 80%+) - Create UI abstraction layer

### 2. Connection Reliability

- [ ] Implement exponential backoff for retries
- [ ] Add connection health monitoring
- [ ] Create API/CLI abstraction layer
- [ ] Migrate to CLI-first approach

### 3. Enable Integration Tests (84 remaining)

- [ ] Authentication (24 tests)
- [ ] Workspace Operations (23 tests)
- [ ] Tree Views (21 tests)
- [ ] Remote Connection (36 tests)

### 4. Test Infrastructure

- [ ] Add SSH/Process/FileSystem mocks to test-helpers
- [ ] Create integration test helpers
- [ ] Implement testing patterns (State Machine, Command)

## Success Metrics

| Metric              | Current | Target |
| ------------------- | ------- | ------ |
| Unit coverage       | 78.49%  | 85%+   |
| Integration tests   | 69      | 150+   |
| Avg method length   | >100    | <50    |
| Files <50% coverage | 1       | 0      |

## Next Steps

1. Extract methods from remote.ts using TDD
2. Create UIProvider interface for commands.ts
3. Enable first batch of integration tests
