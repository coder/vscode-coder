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

The integration tests can be run with coverage analysis using VS Code's built-in coverage support. This provides insights into which parts of the codebase are exercised by the integration tests.

### Running Coverage

```bash
# First, ensure the project is built
yarn pretest

# Run integration tests with coverage
yarn test:integration:coverage
```

### Coverage Output

When running with the `--coverage` flag, VS Code Test will generate:

- **Terminal Output**: Summary of coverage percentages for statements, branches, functions, and lines
- **HTML Report**: Detailed coverage report at `./coverage/index.html`

The coverage data helps identify:

- Untested code paths
- Dead code that's never executed
- Areas that need additional test coverage

To view the detailed HTML coverage report:

```bash
# macOS
open ./coverage/index.html

# Linux  
xdg-open ./coverage/index.html

# Windows
start ./coverage/index.html
```

### Coverage Goals

While 100% coverage is not always practical or necessary, aim to test:

- Core business logic
- Command handlers
- Tree data providers
- Extension activation logic
- Error handling paths

### Best Practices

1. **Write tests for new features**: Add integration tests when adding new functionality
2. **Test user workflows**: Focus on testing complete user scenarios rather than individual functions
3. **Test error cases**: Ensure your extension handles errors gracefully
4. **Keep tests maintainable**: Write clear, focused tests that are easy to understand

### Running Tests in CI

Both unit and integration tests can be run in CI pipelines:

```bash
# Run all tests in CI mode
yarn test:ci && yarn test:integration
```

This ensures that both unit tests and integration tests pass before merging changes.
