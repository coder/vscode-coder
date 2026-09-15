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
if [[ -n "${RUNNER_ARCH:-}" ]]; then
  ELECTRON_RUN_AS_NODE=1 npx --yes "electron@$ELECTRON_VERSION" -e '
    console.log("Electron architecture:", process.arch);
    require("node:assert/strict").equal(process.arch, process.env.RUNNER_ARCH.toLowerCase());
  '
fi

ELECTRON_RUN_AS_NODE=1 \
  npx --yes "electron@$ELECTRON_VERSION" node_modules/vitest/vitest.mjs
