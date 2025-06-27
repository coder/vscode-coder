# Coder Extension Development Guidelines

## Core Philosophy

**First-Principles + KISS**: Question every assumption aggressively, then build the simplest solution from fundamental truths. If there's a straight line, take it, otherwise ask questions and gather any information necessary to determine the right path forward.

## Commands

```bash
yarn lint:fix                                   # Lint with auto-fix
yarn test:ci --coverage                         # Run ALL unit tests (ALWAYS use this)
yarn pretest && yarn test:integration           # Integration tests
yarn mutate                                     # Mutation testing (may take up to 180s - run occasionally)
```

## Key Rules

- **TypeScript strict mode**, no semicolons, 120 char lines
- **Test files**: `*.test.ts` (Vitest for unit, VS Code API for integration)
- **Use test-helpers.ts**: 30+ mock factories available - NEVER create inline mocks, instead create a new factory in that file and import it
- **TDD always**: Write test → implement → refactor
- **Never use any**: Always try to use at least a decently close Partial type or equivalent
- **Never delete tests**: Only delete or skip tests if directly asked, otherwise ask the user for help if fixing the tests does not work.

## Testing Approach

1. Use `yarn test:ci --coverage` before and after EVERY change
2. Import factories and mocks from test-helpers.ts (createMock* and *Factory)
3. Write a test, make sure it fails, and only then make it pass
4. Use proper types, NEVER use eslint-disable to make mocks work
5. If mocking is too complicated, consider whether the function under test needs a minor refactoring that passes existing tests first, to make it easier to test.
