# Debug Logging for Connection and Reconnection Logic

## Purpose & User Problem
**Goal**: Enable engineers to identify the root cause of connection failures from debug logs alone, without needing to reproduce the issue locally.

**Complex Network Environments**:
- **Coder instance**: Virtual machine (AWS/cloud hosted) or local (Coder Desktop)
- **VSCode client**: Desktop binary, VSCode Web, or development container
- **Connection paths**: Direct, VPN, VPC, SSH tunnels, or other proxies

**Problem**: Without detailed logging, distinguishing between user configuration errors, network issues, transient failures, and software bugs requires extensive back-and-forth debugging.

**Edge cases NOT in scope for this pass**: IPv6-specific issues, multi-hop proxy chains, air-gapped environments

## Success Criteria
- **Record** SSH configuration from:
  - VSCode-Coder extension's generated config (primary)
  - User's local SSH config if accessible (via `fs.readFile` of `~/.ssh/config` with error handling)
- **Record** JavaScript runtime errors via:
  - `process.on('uncaughtException', ...)` for unhandled errors
  - `process.on('unhandledRejection', ...)` for promise rejections
  - Memory pressure warnings when heap usage > 90% (check via `process.memoryUsage()`)
  - Process signals: `SIGTERM`, `SIGINT`, `SIGHUP` via `process.on('SIGTERM', ...)`
- **Record** network events (as available from VSCode APIs and HTTP client):
  - Connection timeouts with duration in milliseconds
  - HTTP/WebSocket error codes and messages
  - Retry attempts with backoff delays in milliseconds
- **Record** full connection lifecycle:
  - Initial connection: `{uri: string, timestamp: ISO8601, attemptNumber: number}`
  - Disconnection: `{timestamp: ISO8601, reason: string, duration: milliseconds}`
  - Reconnection: `{timestamp: ISO8601, attemptNumber: number, backoffDelay: milliseconds}`

## Scope & Constraints
- **ALL** new debug logs MUST be gated behind `coder.verbose` flag using `logger.debug()`
- **Masking requirements** - redact these patterns before logging:
  - SSH private keys: Replace content between `-----BEGIN` and `-----END` with `[REDACTED KEY]`
  - Passwords in URLs: Replace `://user:pass@` with `://user:[REDACTED]@`
  - AWS keys: Replace strings matching `AKIA[0-9A-Z]{16}` with `[REDACTED AWS KEY]`
  - Bearer tokens: Replace `Bearer <token>` with `Bearer [REDACTED]`
- **Priority areas for this pass** (in order):
  1. SSH config generation and validation
  2. Connection establishment and disconnection events  
  3. Retry logic and backoff timing
- **Future enhancements** (DO NOT IMPLEMENT - add as `// TODO:` comments only):
  - WebSocket connection logging
  - HTTP API call logging
  - Certificate validation logging
  - Token refresh logging

## Technical Considerations
- **SSH Extension Detection** - Use this priority order from `extension.ts`:
  ```typescript
  vscode.extensions.getExtension("jeanp413.open-remote-ssh") ||
  vscode.extensions.getExtension("codeium.windsurf-remote-openssh") ||
  vscode.extensions.getExtension("anysphere.remote-ssh") ||
  vscode.extensions.getExtension("ms-vscode-remote.remote-ssh")
  ```
- **SSH Config Logging** - Log full config with secrets masked per patterns in Scope section
- **Error Handling** - Wrap ONLY:
  - Network API calls (axios, fetch)
  - SSH config file operations
  - Process spawning
  - Always log full stack trace: `logger.debug(\`Error in ${operation}: ${err.stack}\`)`
- **Log Format** - Use consistent template: `[${component}#${connectionId}] ${phase}: ${message}`
  - component: `ssh`, `api`, `reconnect`, etc.
  - connectionId: unique per connection attempt
  - phase: `init`, `connect`, `disconnect`, `retry`, `error`
  - message: specific details
- **Text Format** - UTF-8 encoding, `\n` line endings (VSCode output channel handles platform differences)

## Out of Scope
- **Existing logger.info calls** - DO NOT modify. Verify with: `grep -n "logger\.info(" src/**/*.ts`
- **Third-party code** - No changes to node_modules or external extension APIs
- **Performance safeguards** - No log rotation or size limits in this pass (VSCode output channels handle this)
  - Note: If SSH configs exceed 10KB, truncate with `[TRUNCATED after 10KB]`
- **Structured logging** - NO JSON objects or structured fields. Use only plain strings to ease future migration
- **User notification** - No UI alerts, notifications, or status bar updates about connection issues