import { LocalProxySettings } from "../../src/settings/proxy";

import type * as vscode from "vscode";

let localProxySettings: vscode.Disposable | undefined;

export function mochaGlobalSetup(): void {
	localProxySettings = LocalProxySettings.initialize();
}

export function mochaGlobalTeardown(): void {
	localProxySettings?.dispose();
}
