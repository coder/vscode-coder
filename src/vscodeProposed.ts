/**
 * This module provides access to VS Code's proposed APIs.
 *
 * ## Why do we need proposed APIs?
 *
 * We use proposed APIs for features not yet in the stable VS Code API:
 *
 * 1. **`useCustom` in MessageOptions** - When `useCustom: true`, VS Code uses its
 *    custom dialog renderer instead of the native OS dialog, regardless of the user's
 *    `window.dialogStyle` setting. This ensures consistent dialog appearance and
 *    behavior across all platforms.
 *
 * 2. **`registerResourceLabelFormatter`** - Allows customizing how remote URIs are
 *    displayed in the VS Code UI (e.g., showing workspace names instead of raw URIs).
 *
 * ## How it works
 *
 * The Remote SSH extension has access to these proposed APIs (via `enabledApiProposals`
 * in its package.json). When we detect the Remote SSH extension, we use
 * `createRequire()` from its extension path to get a vscode module with the
 * proposed APIs enabled.
 *
 * **Important:** During remote connection resolution, we've observed that UI APIs
 * (like `window.showErrorMessage`) may only work reliably when called through the
 * vscode module obtained from the Remote SSH extension's context, rather than our
 * own extension's `import * as vscode from "vscode"`. This is likely because the
 * Remote SSH extension activates first (handling `onResolveRemoteAuthority`) and
 * its vscode module binding is fully established before our resolver code runs.
 *
 * @see {@link file://./typings/vscode.proposed.resolvers.d.ts} for the TypeScript
 * declarations of these proposed APIs.
 *
 * The proxy falls back to regular `vscode` if the proposed API hasn't been
 * initialized yet, so it's safe to use during early startup or in tests.
 */

import * as vscode from "vscode";

let _vscodeProposed: typeof vscode | undefined;

/**
 * Initialize the proposed vscode API. Called once during extension activation
 * after obtaining the proposed API from the Remote SSH extension.
 *
 * @throws Error if called more than once
 */
export function initVscodeProposed(proposed: typeof vscode): void {
	if (_vscodeProposed !== undefined) {
		throw new Error("vscodeProposed has already been initialized");
	}
	_vscodeProposed = proposed;
}

/**
 * A proxy that provides access to the proposed VS Code API.
 * Before initialization, falls back to regular vscode.
 * After initVscodeProposed() is called, uses the proposed API.
 */
export const vscodeProposed: typeof vscode = new Proxy({} as typeof vscode, {
	get(_target, prop: keyof typeof vscode) {
		return (_vscodeProposed ?? vscode)[prop];
	},
});
