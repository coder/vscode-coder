# Testing and Coverage Guide

## Running Tests

### Unit Tests

```bash
# Run unit tests
yarn test

# Run unit tests in CI mode
yarn test:ci
```

### Integration Tests

```bash
# Run integration tests
yarn test:integration

# Run integration tests with coverage analysis
yarn test:integration:coverage
```

## Coverage Analysis

The integration tests can be run with coverage analysis using NYC (Istanbul). This provides insights into which parts of the codebase are exercised by the integration tests.

### Running Coverage

```bash
# First, ensure the project is built
yarn pretest

# Run integration tests with coverage
yarn test:integration:coverage
```

### Coverage Output

After running tests with coverage, you'll find:

- **Terminal Output**: Summary of coverage percentages
- **HTML Report**: Detailed coverage report at `./coverage-integration/index.html`
- **LCOV Report**: Machine-readable coverage data at `./coverage-integration/lcov.info`

### Coverage Configuration

Coverage is configured in `.nycrc.json`:

- **Includes**: All TypeScript files in `src/`
- **Excludes**: Test files, test directory, and typings
- **Reporters**: text (console), lcov (for CI tools), and html (for viewing)

### Viewing Coverage Reports

To view the detailed HTML coverage report:

```bash
# macOS
open ./coverage-integration/index.html

# Linux
xdg-open ./coverage-integration/index.html

# Windows
start ./coverage-integration/index.html
```

### Coverage Goals

While 100% coverage is not always practical or necessary, aim for:

- **Statements**: > 70%
- **Branches**: > 60%
- **Functions**: > 70%
- **Lines**: > 70%

Focus coverage efforts on:

- Core business logic
- Command handlers
- Tree data providers
- Extension activation logic

### Interpreting Coverage

- **Red lines**: Code not executed during tests
- **Yellow lines**: Partially covered branches
- **Green lines**: Fully covered code

Use coverage data to:

1. Identify untested code paths
2. Find dead code
3. Improve test scenarios
4. Ensure critical paths are tested

### Integration with CI

The coverage reports can be integrated with CI tools:

- Upload LCOV reports to services like Codecov or Coveralls
- Set coverage thresholds in CI pipelines
- Track coverage trends over time
