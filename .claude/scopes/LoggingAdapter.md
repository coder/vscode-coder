# Logging Adapter Specification

## Purpose & User Problem

The vscode-coder extension currently handles logging through the Storage class, where logging functionality is commingled with storage concerns. The `writeToCoderOutputChannel` method exists in the Storage class alongside file system operations, secret management, and other unrelated functionality. This makes it difficult to:

- **Debug user-reported issues**: When users report bugs, especially client connection issues that don't reproduce locally, there's no consistent way to enable detailed logging to help diagnose the problem
- **Centralize logging logic**: Logging is tied to the Storage class, which also manages secrets, URLs, CLI binaries, and file operations - a clear violation of single responsibility
- **Control verbosity**: Users can't easily enable debug-level logging when needed without modifying code
- **Standardize output**: While `writeToCoderOutputChannel` adds timestamps, other parts use direct `output.appendLine` calls
- **Expand debugging capabilities**: Adding new diagnostic logging for specific subsystems (like client connections) requires passing the Storage instance around
- **Maintain separation of concerns**: The Storage class has become a "god object" that handles too many responsibilities

## Success Criteria

1. **Centralized Logging**: All log output goes through a single adapter
2. **Log Levels**: Support for `debug` and `info` levels
   - Additional levels can be added in future iterations
3. **Type Safety**: Fully typed TypeScript implementation
   - No `any` types in the logger module or modified files
   - No `@ts-ignore` or `eslint-disable` comments
   - All types explicitly defined or properly inferred
4. **Testable**: 
   - Unit tests use `ArrayAdapter` for fast, isolated testing
   - ArrayAdapter provides immutable snapshots via `getSnapshot()` to prevent test interference
   - Integration tests use `OutputChannelAdapter` to verify VS Code integration
   - Test isolation for concurrent test suites:
     - `setAdapter()` throws if adapter already set (prevents test conflicts)
     - `withAdapter()` provides safe temporary adapter swapping with automatic revert
     - Ideal for Vitest's concurrent test execution
   - `reset()` and `setAdapter()` methods restricted to test environment (NODE_ENV === 'test')
   - `reset()` properly disposes of configuration change listeners to prevent memory leaks
   - Methods throw error if called in production for safety
5. **Performance**: Minimal overhead for logging operations
   - Measured relative to a no-op adapter baseline
   - Debug calls when disabled: < 10% overhead vs no-op
   - Debug calls when enabled: < 10x overhead vs no-op (including formatting)
   - Info calls: < 5x overhead vs no-op
   - Measurement methodology:
     - Use `performance.now()` from Node's `perf_hooks`
     - Compare against `NoOpAdapter` that does nothing
     - Run 10,000 iterations, discard outliers, use median
     - CI passes if within percentage thresholds (not absolute times)
6. **Fault Tolerance**: Logger never throws exceptions
   - Silently swallows OutputChannel errors (e.g., disposed channel on reload)
   - Logging failures must not crash the extension
   - No error propagation from the logging subsystem
   - Accepts that OutputChannel writes may interleave under concurrent access
7. **Live Configuration**: Monitor `coder.verbose` setting changes without requiring extension restart
   - Supports workspace, folder, and global configuration levels
   - Uses the most specific configuration available

## Scope & Constraints

### In Scope
- Extract logging functionality from the Storage class into a dedicated logging adapter
- Create a logging adapter/service with support for debug and info levels
- Convert all existing `writeToCoderOutputChannel` and `output.appendLine` calls to use the adapter
- Maintain integration with VS Code's OutputChannel ("Coder")
  - OutputChannel is created in `extension.ts` and passed to both Logger and Storage
  - Logger uses it for logging via OutputChannelAdapter
  - Storage continues to use it for progress reporting (e.g., binary downloads)
- Provide a simple API for logging (e.g., `logger.debug("message")`, `logger.info("message")`)
  - Callers only provide the message content, not formatting
  - Only string messages accepted (no automatic object serialization)
  - Callers must stringify objects/errors before logging (e.g., using template literals)
- Allow runtime configuration of log levels
- Handle all formatting (timestamps, level tags, etc.) within the logger
- Remove only the `writeToCoderOutputChannel` method from Storage class

### Out of Scope
- External logging services integration (future enhancement)
- File-based logging (all logs go to VS Code OutputChannel)
- Log file rotation or persistence
- Structured logging formats (JSON, etc.)
- Performance metrics or telemetry
- Custom UI for viewing logs (uses VS Code's built-in OutputChannel UI)
- Synchronization of concurrent writes (OutputChannel writes may interleave)
- Automatic object/error serialization (callers must convert to strings)

## Technical Considerations

### Architecture
- Singleton pattern for the logger instance
- Interface-based design with pluggable adapters:
  - `LogAdapter` interface for output handling
  - `OutputChannelAdapter` for VS Code OutputChannel integration
  - `ArrayAdapter` for testing (stores logs in memory)
- OutputChannel ownership and lifecycle:
  - Created once in `extension.ts` activate method
  - Passed to OutputChannelAdapter constructor
  - Also passed to Storage for non-logging uses (progress reporting)
  - Single channel shared between Logger and Storage
  - Note: VS Code OutputChannel is async; concurrent writes may interleave
  - This is acceptable for debugging/diagnostic purposes
  - In browser/web extensions, OutputChannel maps to in-memory buffer (no file I/O)
- Configuration through VS Code settings:
  - `coder.verbose`: boolean setting to enable debug logging (default: false)
  - When true: shows debug level logs
  - When false: shows info level and above only
  - Respects workspace folder-specific settings (uses most specific configuration)
- Configuration monitoring using `vscode.workspace.onDidChangeConfiguration`
  - Only responds to changes in `coder.verbose` specifically
  - Ignores all other configuration changes to avoid unnecessary processing
  - Updates when workspace folders are added/removed or active editor changes
- **Centralized formatting**: All log formatting (timestamps, level tags, source location) happens within the logger implementation, not at call sites

### API Design
```typescript
interface LogAdapter {
  write(message: string): void
  clear(): void
}

interface Logger {
  log(message: string, severity?: LogLevel): void  // Core method, defaults to INFO
  debug(message: string): void  // String only - no object serialization
  info(message: string): void   // String only - no object serialization
  setLevel(level: LogLevel): void
  setAdapter(adapter: LogAdapter): void  // For testing only - throws if adapter already set
  withAdapter<T>(adapter: LogAdapter, fn: () => T): T  // Safe temporary adapter swap
  reset(): void  // For testing only - throws if NODE_ENV !== 'test', disposes listeners
}

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  NONE = 2   // Disables all logging
}

// Example implementations
class OutputChannelAdapter implements LogAdapter {
  constructor(private outputChannel: vscode.OutputChannel) {}
  write(message: string): void {
    try {
      this.outputChannel.appendLine(message)
    } catch {
      // Silently ignore - channel may be disposed
    }
  }
  clear(): void {
    try {
      this.outputChannel.clear()
    } catch {
      // Silently ignore - channel may be disposed
    }
  }
}

class ArrayAdapter implements LogAdapter {
  private logs: string[] = []
  
  write(message: string): void {
    this.logs.push(message)
  }
  
  clear(): void {
    this.logs = []
  }
  
  getSnapshot(): readonly string[] {
    return [...this.logs]  // Return defensive copy
  }
}

class NoOpAdapter implements LogAdapter {
  write(message: string): void {
    // Intentionally empty - baseline for performance tests
  }
  
  clear(): void {
    // Intentionally empty - baseline for performance tests
  }
}
```

### Log Format
- **Standard format**: `[LEVEL] TIMESTAMP MESSAGE`
  - Timestamp in UTC ISO-8601 format (e.g., `2024-01-15T10:30:45.123Z`)
  - Example: `[info] 2024-01-15T10:30:45.123Z Starting extension...`
  - Example: `[debug] 2024-01-15T10:30:45.456Z Processing file: example.ts`
  
- **Debug mode enhancement**: When `coder.verbose` is true, debug logs include source location:
  ```
  [debug] 2024-01-15T10:30:45.456Z Processing file: example.ts
    at processFile (src/utils/fileHandler.ts:45)
  ```
  - Note: In browser/web extensions, `Error().stack` may be empty, disabling source location

### Implementation Plan

1. Create the logger module at `src/logger.ts` with:
   - Singleton pattern implementation
   - LogAdapter interface and implementations (OutputChannelAdapter, ArrayAdapter)
   - Logger initialization accepts OutputChannel (not created internally)
   - Configuration reading from VS Code settings (`coder.verbose`)
     - Use `workspace.getConfiguration()` to respect folder-specific settings
   - Configuration change listener using `workspace.onDidChangeConfiguration`
     - Filter to only handle `coder.verbose` changes using `affectsConfiguration()`
     - Re-read configuration on folder/editor changes to respect local settings
   - Timestamp formatting in UTC ISO-8601 (using `new Date().toISOString()`) and level prefixes
   - Debug mode with source location tracking (file/line info)
     - Gracefully handle empty `Error().stack` in browser environments
   - Test method guards: `reset()` and `setAdapter()` check `process.env.NODE_ENV === 'test'`
   - `setAdapter()` throws if adapter already installed (prevents concurrent test conflicts)
   - `withAdapter()` implementation:
     ```typescript
     withAdapter<T>(adapter: LogAdapter, fn: () => T): T {
       const previous = this.adapter
       this.adapter = adapter
       try {
         return fn()
       } finally {
         this.adapter = previous
       }
     }
     ```
   - `reset()` implementation must dispose configuration listener to prevent memory leaks
2. Create comprehensive tests at `src/logger.test.ts`:
   - Unit tests using ArrayAdapter for logic testing
   - Separate integration tests for OutputChannelAdapter
   - Performance benchmarks:
     - Create NoOpAdapter as baseline
     - Measure relative performance using `performance.now()`
     - Ensure overhead stays within specified percentages
     - Test both cold and warm paths
3. Update `extension.ts`:
   - Create OutputChannel in activate method
   - Initialize Logger with OutputChannel via OutputChannelAdapter
   - Continue passing OutputChannel to Storage (for progress reporting)
4. Extract and refactor the existing `writeToCoderOutputChannel` logic from Storage class
5. Remove ONLY the `writeToCoderOutputChannel` method from Storage (keep OutputChannel for other uses)
6. Systematically replace each `writeToCoderOutputChannel` call with appropriate logger methods
7. For `output.appendLine` calls in Storage, evaluate each:
   - Logging messages → convert to logger calls
   - Progress/status messages → keep as direct OutputChannel calls
8. Verify functionality with existing tests
9. Run linting (`yarn lint`) and ensure code quality

### File Locations
- Logger implementation: `src/logger.ts`
- Tests: `src/logger.test.ts`
- Type definitions included in the logger file

