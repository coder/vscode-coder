Initial prompt:

Make a comprehensive plan for the next steps in this repository to
increase confidence and code quality, and then update TODO.md with that
plan - the plan can be relatively concise, and the current TODO.md has
largely been completed, so feel free to ignore it where it is no longer
valid. My plan in general is to build out the integration test suite and
unit test suite without changing any of the production code, as far as
can be done, and then delve into some modest manual mutation testing to
validate the integration tests actually cover functionality, followed by
expansion of the unit tests to cover 90% (or all reachable code in the
test environment as it currently stands), then to make a light
refactoring pass to clean up complicated functions, anonymous callbacks
(I prefer explicitly named callback functions where the callback has any
real complexity), and simplify the usage of the api and command line tool
in preparation for transitioning all interactions with the coder backend
to the CLI tool, in addition to firming up connection/reconnection which
can be a little flakey.

# Coder VSCode Extension - Quality Improvement Plan

## Phase 1: Test Infrastructure & Coverage (No Production Code Changes)

### 1.1 Integration Test Suite Expansion

- [ ] Map all user-facing commands and functionality
- [ ] Create integration tests for all command palette commands
- [ ] Test workspace connection/reconnection scenarios
- [ ] Test SSH configuration management
- [ ] Test authentication flows (login/logout)
- [ ] Test workspace monitoring and status updates
- [ ] Test CLI tool integration points
- [ ] Achieve 80%+ integration test coverage

### 1.2 Unit Test Suite Expansion

- [ ] Audit current unit test coverage
- [ ] Create unit tests for all utility functions
- [ ] Test error handling paths comprehensively
- [ ] Test edge cases in SSH config parsing
- [ ] Test API client behavior with mocked responses
- [ ] Test CLI manager state transitions
- [ ] Test storage layer operations
- [ ] Achieve 90%+ unit test coverage (excluding unreachable code)

## Phase 2: Test Validation

### 2.1 Manual Mutation Testing

- [ ] Identify critical business logic functions
- [ ] Manually introduce controlled bugs/mutations
- [ ] Verify integration tests catch mutations
- [ ] Document any gaps in test coverage
- [ ] Add tests to cover identified gaps

## Phase 3: Code Quality Improvements

### 3.1 Refactor Anonymous Callbacks

- [ ] Identify all anonymous callback functions
- [ ] Extract complex callbacks to named functions
- [ ] Improve function naming for clarity
- [ ] Add type annotations where missing

### 3.2 Simplify Complex Functions

- [ ] Identify functions with cyclomatic complexity > 10
- [ ] Break down complex functions into smaller units
- [ ] Extract reusable logic into utility functions
- [ ] Improve error handling consistency

### 3.3 API and CLI Consolidation

- [ ] Document all current API interaction points
- [ ] Identify API calls that can use CLI instead
- [ ] Create abstraction layer for API/CLI switching
- [ ] Implement gradual migration to CLI-first approach

## Phase 4: Connection Reliability

### 4.1 Connection/Reconnection Improvements

- [ ] Audit current connection handling code
- [ ] Implement exponential backoff for retries
- [ ] Add connection state monitoring
- [ ] Improve error messages for connection failures
- [ ] Add telemetry for connection reliability metrics
- [ ] Implement connection health checks

## Success Metrics

- Unit test coverage: 90%+ (excluding unreachable code)
- Integration test coverage: 80%+
- All commands have corresponding integration tests
- Zero anonymous callbacks in production code
- All functions have cyclomatic complexity ≤ 10
- Connection failure rate < 1%
- All API interactions have CLI alternatives

## Notes

- No production code changes in Phase 1
- Each phase should be completed before moving to the next
- Regular code reviews for all changes
- Update this document as tasks are completed
