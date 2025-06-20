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
