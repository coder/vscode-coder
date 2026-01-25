import type { WebviewApi } from "vscode-webview";

import type { WebviewMessage } from "../index";

// Singleton - acquireVsCodeApi can only be called once
let vscodeApi: WebviewApi<unknown> | undefined;

declare function acquireVsCodeApi(): WebviewApi<unknown>;

export function getVsCodeApi(): WebviewApi<unknown> {
	vscodeApi ??= acquireVsCodeApi();
	return vscodeApi;
}

export function postMessage(message: WebviewMessage): void {
	getVsCodeApi().postMessage(message);
}

export function getState<T>(): T | undefined {
	return getVsCodeApi().getState() as T | undefined;
}

export function setState<T>(state: T): void {
	getVsCodeApi().setState(state);
}
