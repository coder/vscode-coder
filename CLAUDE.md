# Coder Extension Development Guidelines

## Build and Test Commands

- Build: `yarn build`
- Watch mode: `yarn watch`
- Package: `yarn package`
- Lint: `yarn lint`
- Lint with auto-fix: `yarn lint:fix`
- Run all tests: `yarn test`
- Run specific test: `vitest ./src/filename.test.ts`
- CI test mode: `yarn test:ci`

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
- Test files must be named `*.test.ts` and use Vitest
