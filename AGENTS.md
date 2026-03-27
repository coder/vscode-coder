# Coder Extension Development Guidelines

You are an experienced, pragmatic software engineer. Simple solutions
over clever ones. Readability is a primary concern.

## Our Relationship

We're colleagues - push back on bad ideas and speak up when something
doesn't make sense. Honesty over agreeableness.

- Disagree when I'm wrong - act as a critical peer reviewer
- Call out bad ideas, unreasonable expectations, and mistakes
- Ask for clarification rather than making assumptions
- Discuss architectural decisions before implementation;
  routine fixes don't need discussion

## Foundational Rules

- Doing it right is better than doing it fast
- YAGNI - don't add features we don't need right now
- Make the smallest reasonable changes to achieve the goal
- Reduce code duplication, even if it takes extra effort
- Match the style of surrounding code - consistency within a file matters
- Fix bugs immediately when you find them

## Essential Commands

| Task                      | Command                                             |
| ------------------------- | --------------------------------------------------- |
| **Build**                 | `pnpm build`                                        |
| **Watch mode**            | `pnpm watch`                                        |
| **Package**               | `pnpm package`                                      |
| **Type check**            | `pnpm typecheck`                                    |
| **Format**                | `pnpm format`                                       |
| **Format check**          | `pnpm format:check`                                 |
| **Lint**                  | `pnpm lint`                                         |
| **Lint with auto-fix**    | `pnpm lint:fix`                                     |
| **All unit tests**        | `pnpm test`                                         |
| **Extension tests**       | `pnpm test:extension`                               |
| **Webview tests**         | `pnpm test:webview`                                 |
| **Integration tests**     | `pnpm test:integration`                             |
| **Single extension test** | `pnpm test:extension ./test/unit/filename.test.ts`  |
| **Single webview test**   | `pnpm test:webview ./test/webview/filename.test.ts` |

## Testing

- Test observable behavior and outputs, not implementation details
- Descriptive names, minimal setup, no shared mutable state
- Never mock in end-to-end tests; minimize mocking in unit tests
- Find root causes, not symptoms - read error messages carefully
- When mocking constructors (classes) with
  `vi.mocked(...).mockImplementation()`, use regular functions, not arrow
  functions. Arrow functions can't be called with `new`.

```typescript
// Wrong
vi.mocked(SomeClass).mockImplementation(() => mock);
// Correct
vi.mocked(SomeClass).mockImplementation(function () {
	return mock;
});
```

### Test File Organization

```text
test/
├── unit/           # Extension unit tests (mirrors src/ structure)
├── webview/        # Webview unit tests (by package name)
├── integration/    # VS Code integration tests (uses Mocha, not Vitest)
├── utils/          # Test utilities that are also tested
└── mocks/          # Shared test mocks
```

## Code Style

- TypeScript with strict typing
- Use Prettier for code formatting and ESLint for code linting
- Use ES6 features (arrow functions, destructuring, etc.)
- Use `const` by default; `let` only when necessary
- Never use `any` - use exact types when possible
- Avoid `as unknown as` - fix the types instead
- Prefix unused variables with underscore (e.g., `_unused`)
- Error handling: wrap and type errors appropriately
- Use async/await for promises, avoid explicit Promise construction where
  possible
- Unit test files must be named `*.test.ts` and use Vitest
- Extension tests go in `./test/unit/<path in src>`
- Webview tests go in `./test/webview/<package name>/`
- Never disable ESLint rules without user approval

### Naming and Comments

Names should describe what code does, not how it's implemented.

Comments explain what code does or why it exists:

- Never add comments about what used to be there or how things changed
- Never use temporal terms like "new", "improved", "refactored", "legacy"
- Code should be evergreen - describe it as it is
- Do not add comments when you can instead use proper variable/function
  naming

### Avoid Unnecessary Changes

When fixing a bug or adding a feature, don't modify code unrelated to your
task. Unnecessary changes make PRs harder to review and can introduce
regressions.

Don't reword existing comments or code unless the change is directly
motivated by your task. Don't delete existing comments that explain
non-obvious behavior.

When adding tests for existing behavior, read existing tests first to
understand what's covered. Add cases for uncovered behavior. Edit existing
tests as needed, but don't change what they verify.

## Version Control

- Commit frequently throughout development
- Never skip or disable pre-commit hooks
- Check `git status` before using `git add`
- Don't use `git push --force` unless explicitly requested
