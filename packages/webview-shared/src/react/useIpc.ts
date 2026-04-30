/**
 * Type-safe IPC hook for webview-extension communication.
 * Handles request correlation, timeouts, and cleanup automatically.
 */

import { useEffect, useRef } from "react";

import { postMessage } from "../api";
import { subscribeOne } from "../ipc";

import type {
	CommandDef,
	IpcResponse,
	NotificationDef,
	RequestDef,
} from "@repo/shared";

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
	const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());

	// Cleanup pending requests on unmount
	useEffect(() => {
		return () => {
			for (const req of pendingRequestsRef.current.values()) {
				clearTimeout(req.timeout);
				req.reject(new Error("Component unmounted"));
			}
			pendingRequestsRef.current.clear();
		};
	}, []);

	// Request/response correlation lives here. Notifications are routed via
	// the shared onNotification helper (see the method below).
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data as IpcResponse | undefined;
			if (!msg || typeof msg !== "object") return;
			if (!("requestId" in msg) || !("success" in msg)) return;

			const pending = pendingRequestsRef.current.get(msg.requestId);
			if (!pending) return;

			clearTimeout(pending.timeout);
			pendingRequestsRef.current.delete(msg.requestId);

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
	function request<P, R>(
		definition: RequestDef<P, R>,
		...args: P extends void ? [] : [params: P]
	): Promise<R> {
		const requestId = crypto.randomUUID();
		const params = args[0];

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (pendingRequestsRef.current.has(requestId)) {
					pendingRequestsRef.current.delete(requestId);
					reject(new Error(`Request timeout: ${definition.method}`));
				}
			}, timeoutMs);

			pendingRequestsRef.current.set(requestId, {
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
		definition: CommandDef<P>,
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
		definition: NotificationDef<D>,
		callback: (data: D) => void,
	): () => void {
		return subscribeOne(definition, callback);
	}

	return { request, command, onNotification };
}
