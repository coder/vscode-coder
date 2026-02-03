/**
 * Type-safe IPC hook for webview-extension communication.
 * Handles request correlation, timeouts, and cleanup automatically.
 */

import { useCallback, useEffect, useRef } from "react";

import { postMessage } from "../api";

import type { IpcResponse } from "./protocol";

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30000;

export interface UseIpcOptions {
	/** Request timeout in ms (default: 30000) */
	timeoutMs?: number;
	/** Scope for message routing */
	scope?: string;
}

/**
 * Hook for type-safe IPC with the extension.
 *
 * @example
 * ```tsx
 * // In your API definitions:
 * const GetTasks = defineRequest<void, Task[]>("getTasks");
 * const ViewInCoder = defineCommand<{ taskId: string }>("viewInCoder");
 *
 * // In your component:
 * const ipc = useIpc();
 * const tasks = await ipc.request(GetTasks);  // Type: Task[]
 * ipc.command(ViewInCoder, { taskId: "123" }); // Fire-and-forget
 * ```
 */
export function useIpc(options: UseIpcOptions = {}) {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, scope } = options;
	const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());

	// Cleanup pending requests on unmount
	useEffect(() => {
		return () => {
			for (const [, req] of pendingRequests.current) {
				clearTimeout(req.timeout);
				req.reject(new Error("Component unmounted"));
			}
			pendingRequests.current.clear();
		};
	}, []);

	// Handle responses from extension
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data as IpcResponse | undefined;
			if (!msg || typeof msg.requestId !== "string" || !("success" in msg)) {
				return;
			}

			const pending = pendingRequests.current.get(msg.requestId);
			if (!pending) return;

			clearTimeout(pending.timeout);
			pendingRequests.current.delete(msg.requestId);

			if (msg.success) {
				pending.resolve(msg.data);
			} else {
				pending.reject(new Error(msg.error || "Request failed"));
			}
		};

		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, []);

	/** Send request and await typed response */
	const request = useCallback(
		<P, R>(
			definition: {
				method: string;
				scope?: string;
				_params?: P;
				_response?: R;
			},
			...args: P extends void ? [] : [params: P]
		): Promise<R> => {
			const requestId = crypto.randomUUID();
			const params = args[0];

			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					if (pendingRequests.current.has(requestId)) {
						pendingRequests.current.delete(requestId);
						reject(new Error(`Request timeout: ${definition.method}`));
					}
				}, timeoutMs);

				pendingRequests.current.set(requestId, {
					resolve: resolve as (value: unknown) => void,
					reject,
					timeout,
				});

				postMessage({
					method: definition.method,
					scope: scope ?? definition.scope,
					requestId,
					params,
				});
			});
		},
		[scope, timeoutMs],
	);

	/** Send command without waiting (fire-and-forget) */
	const command = useCallback(
		<P>(
			definition: { method: string; scope?: string; _params?: P },
			...args: P extends void ? [] : [params: P]
		): void => {
			const params = args[0];
			postMessage({
				method: definition.method,
				scope: scope ?? definition.scope,
				params,
			});
		},
		[scope],
	);

	return { request, command };
}
