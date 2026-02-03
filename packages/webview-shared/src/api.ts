import type { WebviewApi } from "vscode-webview";

import type { WebviewMessage } from "./index";

// Singleton because acquireVsCodeApi() throws if called more than once
let vscodeApi: WebviewApi<unknown> | undefined;

function getVsCodeApi(): WebviewApi<unknown> {
	vscodeApi ??= acquireVsCodeApi();
	return vscodeApi;
}

/**
 * Post a message to the extension.
 * Accepts legacy WebviewMessage format or any object for the new IPC protocol.
 */
export function postMessage(
	message: WebviewMessage | Record<string, unknown>,
): void {
	getVsCodeApi().postMessage(message);
}

export function getState<T>(): T | undefined {
	return getVsCodeApi().getState() as T | undefined;
}

export function setState<T>(state: T): void {
	getVsCodeApi().setState(state);
}
