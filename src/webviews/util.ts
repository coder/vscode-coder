import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { toError } from "../error/errorUtils";
import { type Logger } from "../logging/logger";

import type { IpcRequest, IpcResponse, NotificationDef } from "@repo/shared";

/**
 * Get the HTML content for a webview.
 */
export function getWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	webviewName: string,
	title: string,
): string {
	const nonce = getNonce();
	const baseUri = vscode.Uri.joinPath(
		extensionUri,
		"dist",
		"webviews",
		webviewName,
	);
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(baseUri, "index.js"),
	);
	const styleUri = webview.asWebviewUri(
		vscode.Uri.joinPath(baseUri, "index.css"),
	);

	// The vscode-elements library looks for a link element with "vscode-codicon-stylesheet"
	// ID to load the codicons font inside its shadow DOM components
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link id="vscode-codicon-stylesheet" rel="stylesheet" href="${styleUri.toString()}" nonce="${nonce}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

export function getNonce(): string {
	return randomBytes(16).toString("base64");
}

const HTML_ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Escape characters with special meaning in HTML so user-controlled strings
 *  can be safely interpolated into markup. */
export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

export function isIpcRequest(msg: unknown): msg is IpcRequest {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"requestId" in msg &&
		typeof (msg as IpcRequest).requestId === "string" &&
		"method" in msg &&
		typeof (msg as IpcRequest).method === "string"
	);
}

export function isIpcCommand(
	msg: unknown,
): msg is { method: string; params?: unknown } {
	return (
		typeof msg === "object" &&
		msg !== null &&
		!("requestId" in msg) &&
		"method" in msg &&
		typeof (msg as { method: string }).method === "string"
	);
}

/** Push a typed notification to a webview. */
export function notifyWebview<D>(
	webview: vscode.Webview,
	def: NotificationDef<D>,
	...args: D extends void ? [] : [data: D]
): void {
	webview.postMessage({
		type: def.method,
		...(args.length > 0 ? { data: args[0] } : {}),
	});
}

export interface DispatchOptions {
	logger: Logger;
	/**
	 * Predicate run after a handler throws. If it returns true the error is
	 * also shown via `showErrorMessage`. Defaults: commands show, requests
	 * don't (see `dispatchCommand` / `dispatchRequest`).
	 */
	showErrorToUser?: (method: string) => boolean;
}

/**
 * Dispatch a fire-and-forget command. On failure, logs a warning and (by
 * default) shows the error to the user.
 */
export async function dispatchCommand(
	message: { method: string; params?: unknown },
	handlers: Record<string, (params: unknown) => void | Promise<void>>,
	options: DispatchOptions,
): Promise<void> {
	const { method, params } = message;
	const showToUser = options.showErrorToUser ?? (() => true);
	try {
		const handler = handlers[method];
		if (!handler) {
			throw new Error(`Unknown command: ${method}`);
		}
		await handler(params);
	} catch (err) {
		const errorMessage = toError(err).message;
		options.logger.warn(`Command ${method} failed`, err);
		if (showToUser(method)) {
			vscode.window.showErrorMessage(errorMessage);
		}
	}
}

/**
 * Dispatch a request and post a typed response back to the webview. On
 * failure, logs a warning, posts an error response, and (if
 * `showErrorToUser(method)` returns true) shows the error to the user;
 * default is not to show.
 *
 * If `webview` is undefined (e.g. the view was disposed mid-flight) the
 * response is dropped silently.
 */
export async function dispatchRequest(
	message: IpcRequest,
	handlers: Record<string, (params: unknown) => Promise<unknown>>,
	webview: vscode.Webview | undefined,
	options: DispatchOptions,
): Promise<void> {
	const { requestId, method, params } = message;
	const showToUser = options.showErrorToUser ?? (() => false);
	const respond = (response: IpcResponse) => {
		void webview?.postMessage(response);
	};
	try {
		const handler = handlers[method];
		if (!handler) {
			throw new Error(`Unknown method: ${method}`);
		}
		const data = await handler(params);
		respond({ requestId, method, success: true, data });
	} catch (err) {
		const errorMessage = toError(err).message;
		options.logger.warn(`Request ${method} failed`, err);
		respond({ requestId, method, success: false, error: errorMessage });
		if (showToUser(method)) {
			vscode.window.showErrorMessage(errorMessage);
		}
	}
}

/**
 * Fire `handler` on `event` only while `panel.visible` is true.
 */
export function onWhileVisible<T>(
	panel: { readonly visible: boolean },
	event: vscode.Event<T>,
	handler: () => void,
): vscode.Disposable {
	return event(() => {
		if (panel.visible) {
			handler();
		}
	});
}
