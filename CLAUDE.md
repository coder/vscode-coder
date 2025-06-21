# Coder Extension Development Guidelines

General instructions:

Your goal is to help me arrive at the most elegant and effective solution by combining two modes of thinking: 1. First-Principles Deconstruction: Act like a physicist. Break down my ideas, plans, or questions to their most fundamental truths. Aggressively question every assumption until only the core, undeniable components remain. Do not accept my premises at face value. 2. Pragmatic Reconstruction (KISS): Act like an engineer. From those fundamental truths, build the simplest, most direct solution possible. If there's a straight line, point to it. Reject any complexity that doesn't directly serve a core requirement. Always present your counter-arguments and alternative solutions through this lens.

## Build and Test Commands

- Build: `yarn build`
- Watch mode: `yarn watch`
- Package: `yarn package`
- Lint with auto-fix: `yarn lint:fix` (always use this instead of regular lint)
- Run all unit tests: `yarn test:ci`
- Run specific unit test: `yarn test:ci` (always use this instead of vitest directly)
- Integration tests: `yarn pretest; yarn test:integration`
- Unit test coverage: `yarn test:ci --coverage`
- Full test suite: `yarn test:ci --coverage && yarn pretest && yarn test:integration`

## Code Style Guidelines

- TypeScript with strict typing
- No semicolons (see `.prettierrc`)
- Trailing commas for all multi-line lists
- 120 character line width
- Use ES6 features (arrow functions, destructuring, etc.)
- Use `const` by default; `let` only when necessary
- Prefix unused variables with underscore (e.g., `_unused`)
- Sort imports alphabetically in groups: external → parent → sibling
- Error handling: wrap and type errors appropriately
- Use async/await for promises, avoid explicit Promise construction where possible
- Unit test files must be named `*.test.ts` and use Vitest
- Integration test files must be named `*.test.ts` and be located in the `src/test` directory
- Avoid eslint-disable comments where at all possible - it's better to make a custom type than disable linting

## Test Coverage Guidelines

Current status: **48.4% overall unit test coverage** with 212 unit tests and 69 integration tests passing.

### Testing Priority Framework
1. **Files with <50% coverage** need immediate attention (remote.ts: 8.84%, commands.ts: 21.09%)
2. **Add incremental tests** - focus on 1-3 tests per session to see measurable progress
3. **Target coverage improvements** of 5-15 percentage points per file per session
4. **Always run coverage after changes** to measure progress: `yarn test:ci --coverage`

### Testing Patterns to Follow
- **Mock external dependencies** properly using vi.mock() and proper TypeScript types
- **Create reusable mock types** instead of using `any` or eslint-disable
- **Test core functionality first** - constructor, main methods, error paths
- **Use descriptive test names** that explain the specific behavior being tested
- **Group related tests** in describe blocks for better organization

### Files with Excellent Coverage (>90%) - Use as Examples:
- featureSet.ts: 100%
- proxy.ts: 100% 
- util.ts: 97.31%
- headers.ts: 96.49%
- api-helper.ts: 96.36%
- sshConfig.ts: 96.21%
- api.ts: 95.52%

### Current Testing Approach
- **No production code changes** during testing phase
- **Incremental improvements** - systematically work through files by coverage priority
- **Comprehensive mocking** for VS Code API, external dependencies, and internal modules
- **Both positive and negative test cases** for robust coverage
