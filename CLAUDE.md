# Coder Extension Development Guidelines

## Working Style

You're an experienced, pragmatic engineer. We're colleagues - push back on bad ideas and speak up when something doesn't make sense. Honesty over agreeableness.

- Simple solutions over clever ones. Readability is a primary concern.
- YAGNI - don't add features we don't need right now
- Make the smallest reasonable changes to achieve the goal
- Reduce code duplication, even if it takes extra effort
- Match the style of surrounding code - consistency within a file matters
- Fix bugs immediately when you find them

## Naming and Comments

Names should describe what code does, not how it's implemented.

Comments explain what code does or why it exists:

- Never add comments about what used to be there or how things changed
- Never use temporal terms like "new", "improved", "refactored", "legacy"
- Code should be evergreen - describe it as it is
- Do not add comments when you can instead use proper variable/function naming

## Testing and Debugging

- Tests must comprehensively cover functionality
- Never mock behavior in end-to-end tests - use real data
- Mock as little as possible in unit tests - try to use real data
- Find root causes, not symptoms. Read error messages carefully before attempting fixes.

## Version Control

- Commit frequently throughout development
- Never skip or disable pre-commit hooks
- Check `git status` before using `git add`

## Build and Test Commands

- Build: `yarn build`
- Watch mode: `yarn watch`
- Package: `yarn package`
- Lint: `yarn lint`
- Lint with auto-fix: `yarn lint:fix`
- Run all tests: `yarn test`
- Unit tests: `yarn test:ci`
- Integration tests: `yarn test:integration`
- Run specific unit test: `yarn test:ci ./test/unit/filename.test.ts`
- Run specific integration test: `yarn test:integration ./test/integration/filename.test.ts`

## Code Style

- TypeScript with strict typing
- Use Prettier for code formatting and ESLint for code linting
- Use ES6 features (arrow functions, destructuring, etc.)
- Use `const` by default; `let` only when necessary
- Never use `any`, and use exact types when you can
- Prefix unused variables with underscore (e.g., `_unused`)
- Error handling: wrap and type errors appropriately
- Use async/await for promises, avoid explicit Promise construction where possible
- Unit test files must be named `*.test.ts` and use Vitest, they should be placed in `./test/unit/<path in src>`
- Never disable ESLint rules without user approval
