import * as vscode from "vscode";

import { toError } from "../error/errorUtils";
import { type Logger } from "../logging/logger";

import type { IpcRequest, IpcResponse, NotificationDef } from "@repo/shared";

export interface DispatchOptions {
	readonly logger: Logger;
	/** Methods whose failures warrant a dialog; others are logged only. */
	readonly userActions?: ReadonlySet<string>;
}

/** Push a typed notification to a webview. No-op when `webview` is undefined. */
export function notifyWebview<D>(
	webview: vscode.Webview | undefined,
	def: NotificationDef<D>,
	...args: D extends void ? [] : [data: D]
): void {
	void webview?.postMessage({
		type: def.method,
		...(args.length > 0 ? { data: args[0] } : {}),
	});
}

/** Dispatch a fire-and-forget command, logging any handler failure. */
export async function dispatchCommand(
	message: { method: string; params?: unknown },
	handlers: Record<string, (params: unknown) => void | Promise<void>>,
	options: DispatchOptions,
): Promise<void> {
	const { method, params } = message;
	try {
		const handler = handlers[method];
		if (!handler) {
			throw new Error(`Unknown command: ${method}`);
		}
		await handler(params);
	} catch (err) {
		handleDispatchError("Command", method, err, options);
	}
}

/**
 * Dispatch a request and post a typed response back. If the handler throws,
 * posts a failure response. If `webview` is undefined the response is dropped.
 */
export async function dispatchRequest(
	message: IpcRequest,
	handlers: Record<string, (params: unknown) => Promise<unknown>>,
	webview: vscode.Webview | undefined,
	options: DispatchOptions,
): Promise<void> {
	const { requestId, method, params } = message;
	const respond = (response: IpcResponse) => {
		void webview?.postMessage(response);
	};
	try {
		const handler = handlers[method];
		if (!handler) {
			throw new Error(`Unknown request: ${method}`);
		}
		const data = await handler(params);
		respond({ requestId, method, success: true, data });
	} catch (err) {
		respond({
			requestId,
			method,
			success: false,
			error: toError(err).message,
		});
		handleDispatchError("Request", method, err, options);
	}
}

export interface WebviewHandlers {
	readonly requests: Readonly<
		Record<string, (params: unknown) => Promise<unknown>>
	>;
	readonly commands: Readonly<
		Record<string, (params: unknown) => void | Promise<void>>
	>;
}

/** Route a message from a webview to its request or command handler. */
export async function dispatchWebviewMessage(
	message: unknown,
	handlers: WebviewHandlers,
	webview: vscode.Webview | undefined,
	options: DispatchOptions,
): Promise<void> {
	if (isIpcRequest(message)) {
		await dispatchRequest(message, handlers.requests, webview, options);
	} else if (isIpcCommand(message)) {
		await dispatchCommand(message, handlers.commands, options);
	} else {
		options.logger.warn("Unexpected webview message", message);
	}
}

/** Fire `handler` on `event` only while `panel.visible` is true. */
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

/** Check if message is a request (has requestId). */
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

/** Check if message is a command (has method but no requestId). */
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

function handleDispatchError(
	kind: "Command" | "Request",
	method: string,
	err: unknown,
	options: DispatchOptions,
): void {
	const message = toError(err).message;
	options.logger.warn(`${kind} ${method} failed`, err);
	if (options.userActions?.has(method)) {
		vscode.window.showErrorMessage(message);
	}
}
