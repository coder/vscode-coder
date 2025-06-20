# Integration Test Plan

## Overview

This directory contains stubbed integration tests for all user-facing functionality in the Coder VS Code extension. All tests are currently marked as `test.skip()` and need to be implemented.

## Test Categories

### 1. Authentication (`authentication.test.ts`)

- **Login Flow**: URL input, token validation, credential storage
- **Logout Flow**: Credential clearing, context updates
- **Token Management**: Validation, refresh, CLI configuration

### 2. Workspace Operations (`workspace-operations.test.ts`)

- **Open Workspace**: Agent selection, folder navigation, window management
- **Create Workspace**: Template navigation
- **Update Workspace**: Version updates, confirmation dialogs
- **Navigate**: Dashboard and settings page navigation
- **Refresh**: Workspace list updates

### 3. Remote Connection (`remote-connection.test.ts`)

- **SSH Connection**: Config generation, environment setup, proxy handling
- **Remote Authority**: Resolution, naming, multi-agent support
- **Connection Monitoring**: Status updates, notifications
- **Binary Management**: Download, update, validation

### 4. Tree Views (`tree-views.test.ts`)

- **My Workspaces View**: Display, grouping, real-time updates
- **All Workspaces View**: Owner-specific functionality
- **Tree Item Actions**: Open, navigate, app interactions
- **Tree View Toolbar**: Authentication-based UI updates

### 5. DevContainer (`devcontainer.test.ts`)

- **Open DevContainer**: Authority generation, folder handling
- **DevContainer URI Handler**: Parameter validation, authentication

### 6. URI Handler (`uri-handler.test.ts`)

- **vscode:// URI Handling**: Path routing, parameter validation, authentication flow

### 7. Settings (`settings.test.ts`)

- **SSH Configuration**: Custom values, validation, precedence
- **Security Settings**: TLS configuration, insecure mode
- **Binary Settings**: Source, destination, download control
- **Connection Settings**: Default URL, autologin, proxy configuration

### 8. Error Handling (`error-handling.test.ts`)

- **Certificate Errors**: Notifications, self-signed handling
- **Network Errors**: Timeouts, retries, proxy issues
- **Authentication Errors**: 401 handling, re-authentication
- **Workspace Errors**: Not found, build failures, permissions
- **General Error Handling**: Logging, user messages, cleanup

### 9. Logs (`logs.test.ts`)

- **View Logs Command**: File opening, missing logs handling
- **Output Channel**: Operation logging, API logging
- **CLI Logging**: Verbose mode, file output

### 10. Storage (`storage.test.ts`)

- **Credential Storage**: URL/token storage, migration, clearing
- **URL History**: Maintenance, limits, persistence
- **CLI Configuration**: File writing, updates
- **Binary Storage**: Location, version tracking, cleanup

### 11. App Status (`app-status.test.ts`)

- **Open App Status**: URL apps, command apps, SSH integration

## Implementation Priority

Based on the TODO.md plan, implement tests in this order:

1. **Core Authentication**: Login/logout flows (foundation for other tests)
2. **Workspace Operations**: Open, create, refresh (most common user actions)
3. **Tree Views**: Visual feedback and user interaction
4. **Remote Connection**: SSH and connection handling
5. **Settings**: Configuration behavior
6. **Error Handling**: Robustness testing
7. **Remaining Features**: DevContainer, URI handler, logs, storage, app status

## Test Implementation Guidelines

1. Remove `test.skip()` when implementing
2. Use actual VS Code API calls where possible
3. Mock external dependencies (API calls, file system)
4. Test both success and failure paths
5. Verify UI updates (notifications, tree views, status bar)
6. Check context variable updates
7. Validate command availability based on state

## Coverage Goals

- Integration tests: 80%+ coverage
- Focus on user-visible behavior
- Test command palette commands
- Test tree view interactions
- Test settings changes
- Test error scenarios

## Notes

- These tests complement the existing unit tests
- Focus on end-to-end user workflows
- Use VS Code Test API for integration testing
- Consider using test fixtures for common scenarios
