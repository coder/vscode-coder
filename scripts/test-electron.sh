#!/bin/bash
# Run all unit tests (extension + webview) inside a specific Electron version's runtime.
#
# See https://github.com/ewanharris/vscode-versions for version mapping.
#
# Usage: ./scripts/test-electron.sh <electron-version>
# Examples:
#   ./scripts/test-electron.sh 37
#   ./scripts/test-electron.sh latest

set -e

ELECTRON_VERSION="${1:?Usage: $0 <electron-version>}"

echo "Running tests with Electron $ELECTRON_VERSION..."
ELECTRON_RUN_AS_NODE=1 \
  npx --yes "electron@$ELECTRON_VERSION" node_modules/vitest/vitest.mjs
