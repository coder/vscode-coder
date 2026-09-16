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

# npx can't grant allowScripts consent (npm 12+ blocks electron's postinstall)
# or override yauzl (yauzl 2 extracts almost nothing on Node 24.16+). pnpm can.
RUNNER_DIR="$(mktemp -d)"
trap 'rm -rf "$RUNNER_DIR"' EXIT
echo '{ "name": "electron-runner", "private": true }' > "$RUNNER_DIR/package.json"
cat > "$RUNNER_DIR/pnpm-workspace.yaml" <<'YAML'
allowBuilds:
  electron: true
overrides:
  yauzl: ^3.4.0
# Opt out of the release-age quarantine so `latest` really means latest.
minimumReleaseAge: 0
YAML

pnpm --dir "$RUNNER_DIR" add "electron@$ELECTRON_VERSION"

echo "Running tests with Electron $ELECTRON_VERSION..."
ELECTRON_RUN_AS_NODE=1 \
  "$RUNNER_DIR/node_modules/.bin/electron" node_modules/vitest/vitest.mjs
