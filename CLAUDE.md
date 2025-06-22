# Coder Extension Development Guidelines

General instructions:

Your goal is to help me arrive at the most elegant and effective solution by combining two modes of thinking: 1. First-Principles Deconstruction: Act like a physicist. Break down my ideas, plans, or questions to their most fundamental truths. Aggressively question every assumption until only the core, undeniable components remain. Do not accept my premises at face value. 2. Pragmatic Reconstruction (KISS): Act like an engineer. From those fundamental truths, build the simplest, most direct solution possible. If there's a straight line, point to it. Reject any complexity that doesn't directly serve a core requirement. Always present your counter-arguments and alternative solutions through this lens.

## Build and Test Commands

- Build: `yarn build`
- Watch mode: `yarn watch`
- Package: `yarn package`
- Lint with auto-fix: `yarn lint:fix` (always use this instead of regular lint)
- **Run all unit tests with coverage: `yarn test:ci --coverage`** (ALWAYS use this, not individual file testing)
- Integration tests: `yarn pretest; yarn test:integration`
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

Current status: **74.35% overall unit test coverage** with 359 unit tests and 69 integration tests passing.

### TDD Approach for New Features

1. **Write failing test first** - define expected behavior
2. **Implement minimal code** to make test pass
3. **Run full test suite** with `yarn test:ci --coverage`
4. **Refactor if needed** while keeping tests green
5. **Ensure backward compatibility** when modifying existing interfaces

### Testing Priority Framework

1. **Files with <50% coverage** need immediate attention (remote.ts: 49.21%, extension.ts: 38.68%)
2. **Add incremental tests** - focus on measurable progress each session
3. **Target coverage improvements** of 5-15 percentage points per file
4. **ALWAYS use `yarn test:ci --coverage`** - never test individual files

### Testing Patterns to Follow

- **Create factory functions** for common test setups (see test-helpers.ts)
- **Use createMockOutputChannelWithLogger()** for consistent Logger testing
- **Avoid `as any`** - create proper mock types or use `as never` for VS Code mocks
- **Mock external dependencies** properly using vi.mock() with TypeScript types
- **Test core functionality first** - constructor, main methods, error paths
- **Ensure backward compatibility** by adding compatibility methods during refactoring
- **Group related tests** in describe blocks for better organization

### Test Helper Patterns

```typescript
// Example factory function from test-helpers.ts
export function createMockOutputChannelWithLogger(options?: {
	verbose?: boolean;
}): {
	mockOutputChannel: { appendLine: ReturnType<typeof vi.fn> };
	logger: Logger;
}
```

### Files with Excellent Coverage (>90%) - Use as Examples:

- featureSet.ts: 100%
- proxy.ts: 100%
- logger.ts: 98.44% (good TDD example)
- util.ts: 97.31%
- headers.ts: 96.49%
- api-helper.ts: 96.36%
- sshConfig.ts: 96.21%
- api.ts: 95.52%
- error.ts: 90.44%

### Current Development Approach

- **TDD for new features** - test first, implement second
- **Incremental refactoring** - small, measurable improvements
- **Backward compatibility** - add compatibility methods when changing interfaces
- **Factory functions in test-helpers.ts** - reusable test setup patterns
- **Systematic cleanup** - remove `as any` casts, add proper types
- **Measure progress constantly** - run `yarn test:ci --coverage` after every change

### Refactoring Strategy

When replacing legacy patterns (e.g., writeToCoderOutputChannel):
1. Add backward compatibility method to new implementation
2. Write tests verifying compatibility
3. Incrementally replace usage starting with highest-impact files
4. Maintain full test suite passing throughout

### Example: Logger Integration Pattern

```typescript
// 1. Add backward compatibility to new class
class Logger {
  // ... new methods ...
  
  // Backward compatibility for legacy code
  writeToCoderOutputChannel(message: string): void {
    this.info(message);
  }
}

// 2. Create factory in test-helpers.ts
export function createMockOutputChannelWithLogger() {
  const mockOutputChannel = { appendLine: vi.fn() };
  const logger = new Logger(mockOutputChannel);
  return { mockOutputChannel, logger };
}

// 3. Test compatibility before refactoring
it("should be backward compatible", () => {
  const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();
  logger.writeToCoderOutputChannel("Test");
  expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
    expect.stringMatching(/\[.*\] \[INFO\] Test/)
  );
});
```
