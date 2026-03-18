#!/bin/bash
# Run extension unit tests inside a specific Electron version's runtime.
#
# Only runs the "extension" project because Electron's patched fs.readFileSync
# causes stack overflows in vitest's forks pool with jsdom (webview tests).
# Webview tests should be run separately via `pnpm test:webview`.
#
# See https://github.com/ewanharris/vscode-versions for version mapping.
#
# Usage: ./scripts/test-electron.sh <electron-version>
# Examples:
#   ./scripts/test-electron.sh 32
#   ./scripts/test-electron.sh latest

set -e

ELECTRON_VERSION="${1:?Usage: $0 <electron-version>}"

echo "Running extension tests with Electron $ELECTRON_VERSION..."
# --experimental-require-module needed for Electron 32-34 (Node 20.18), harmless for 35+ (Node 22+)
ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--experimental-require-module --disable-warning=ExperimentalWarning" \
  npx --yes "electron@$ELECTRON_VERSION" node_modules/vitest/vitest.mjs --project extension
