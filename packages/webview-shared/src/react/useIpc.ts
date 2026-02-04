/**
 * Type-safe IPC hook for webview-extension communication.
 * Handles request correlation, timeouts, and cleanup automatically.
 */

import { useEffect, useRef } from "react";

import { postMessage } from "../api";

import type { IpcNotification, IpcResponse } from "@repo/shared";

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30000;

export interface UseIpcOptions {
	/** Request timeout in ms (default: 30000) */
	timeoutMs?: number;
}

type NotificationHandler = (data: unknown) => void;

/**
 * Hook for type-safe IPC with the extension.
 *
 * @example
 * ```tsx
 * const ipc = useIpc();
 * const tasks = await ipc.request(getTasks);  // Type: Task[]
 * ipc.command(viewInCoder, { taskId: "123" }); // Fire-and-forget
 *
 * // Subscribe to notifications
 * useEffect(() => {
 *   return ipc.onNotification(tasksUpdated, (tasks) => {
 *     setTasks(tasks);  // tasks is typed as Task[]
 *   });
 * }, []);
 * ```
 */
export function useIpc(options: UseIpcOptions = {}) {
	const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
	const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());
	const notificationHandlers = useRef<Map<string, Set<NotificationHandler>>>(
		new Map(),
	);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			for (const req of pendingRequests.current.values()) {
				clearTimeout(req.timeout);
				req.reject(new Error("Component unmounted"));
			}
			pendingRequests.current.clear();
			notificationHandlers.current.clear();
		};
	}, []);

	// Handle responses and notifications
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data as IpcResponse | IpcNotification | undefined;

			if (!msg || typeof msg !== "object") {
				return;
			}

			// Response handling (has requestId + success)
			if ("requestId" in msg && "success" in msg) {
				const pending = pendingRequests.current.get(msg.requestId);
				if (!pending) return;

				clearTimeout(pending.timeout);
				pendingRequests.current.delete(msg.requestId);

				if (msg.success) {
					pending.resolve(msg.data);
				} else {
					pending.reject(new Error(msg.error || "Request failed"));
				}
				return;
			}

			// Notification handling (has type, no requestId)
			if ("type" in msg && !("requestId" in msg)) {
				const handlers = notificationHandlers.current.get(msg.type);
				if (handlers) {
					for (const h of handlers) {
						h(msg.data);
					}
				}
			}
		};

		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, []);

	/** Send request and await typed response */
	function request<P, R>(
		definition: {
			method: string;
			_types?: { params: P; response: R };
		},
		...args: P extends void ? [] : [params: P]
	): Promise<R> {
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
				requestId,
				params,
			});
		});
	}

	/** Send command without waiting (fire-and-forget) */
	function command<P>(
		definition: { method: string; _types?: { params: P } },
		...args: P extends void ? [] : [params: P]
	): void {
		postMessage({
			method: definition.method,
			params: args[0],
		});
	}

	/**
	 * Subscribe to push notifications from the extension.
	 * Returns an unsubscribe function that should be called on cleanup.
	 *
	 * @example
	 * ```tsx
	 * useEffect(() => {
	 *   return ipc.onNotification(tasksUpdated, (tasks) => {
	 *     setTasks(tasks);
	 *   });
	 * }, []);
	 * ```
	 */
	function onNotification<D>(
		definition: { method: string; _types?: { data: D } },
		callback: (data: D) => void,
	): () => void {
		const method = definition.method;
		let handlers = notificationHandlers.current.get(method);
		if (!handlers) {
			handlers = new Set();
			notificationHandlers.current.set(method, handlers);
		}
		handlers.add(callback as NotificationHandler);

		// Return unsubscribe function
		return () => {
			const h = notificationHandlers.current.get(method);
			if (h) {
				h.delete(callback as NotificationHandler);
				if (h.size === 0) {
					notificationHandlers.current.delete(method);
				}
			}
		};
	}

	return { request, command, onNotification };
}
