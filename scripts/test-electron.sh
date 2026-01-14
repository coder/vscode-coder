#!/bin/bash
# Run tests inside a specific Electron version's runtime.
#
# Requires Electron 32+ due to Vitest ESM requirements.
#
# Usage: ./scripts/test-electron.sh <electron-version>
# Examples:
#   ./scripts/test-electron.sh 32
#   ./scripts/test-electron.sh latest

set -e

ELECTRON_VERSION="${1:?Usage: $0 <electron-version>}"

echo "Running tests with Electron $ELECTRON_VERSION..."
# --experimental-require-module needed for Electron 32-33 (Node 20.18), harmless for 34+
ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--experimental-require-module" \
  npx --yes "electron@$ELECTRON_VERSION" node_modules/vitest/vitest.mjs
